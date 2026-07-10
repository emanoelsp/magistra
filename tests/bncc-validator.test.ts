import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IaSugestao } from "../lib/types/firestore";
import {
  buildAllowedCodes,
  buildCorrecaoPrompt,
  filterSugestoes,
  filterWithRetry,
  invalidCodesIn,
} from "../lib/services/bncc-validator";

function sug(id: string, label: string, descricao?: string): IaSugestao {
  return { id, label, ...(descricao ? { descricao } : {}) };
}

const ALLOWED = buildAllowedCodes({
  bncc: [{ codigo: "EF89EF03" }, { codigo: "EF15LP01" }],
  saeb: [{ codigo: "D5" }],
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("invalidCodesIn", () => {
  it("retorna vazio quando todos os códigos citados estão no allowed set", () => {
    expect(invalidCodesIn(sug("1", "Trabalhar (EF89EF03) com D5"), ALLOWED)).toEqual([]);
  });

  it("aponta códigos fora do contexto RAG", () => {
    expect(invalidCodesIn(sug("1", "Aplicar EF67LP99"), ALLOWED)).toEqual(["EF67LP99"]);
  });

  it("pula validação quando o allowed set está vazio (sem contexto)", () => {
    expect(invalidCodesIn(sug("1", "Aplicar EF67LP99"), new Set())).toEqual([]);
  });
});

describe("filterSugestoes", () => {
  it("remove só as sugestões inválidas e mantém as válidas", () => {
    const res = filterSugestoes(
      [sug("ok", "Usar EF89EF03"), sug("bad", "Usar EF67LP99")],
      ALLOWED,
    );
    expect(res.filtered.map((s) => s.id)).toEqual(["ok"]);
    expect(res.removedCount).toBe(1);
    expect(res.allInvalid).toBe(false);
    expect(res.invalidCodes).toEqual(["EF67LP99"]);
  });

  it("sinaliza allInvalid quando nenhuma sugestão sobrevive", () => {
    const res = filterSugestoes(
      [sug("a", "Usar EF67LP99"), sug("b", "Usar D29")],
      ALLOWED,
    );
    expect(res.filtered).toEqual([]);
    expect(res.allInvalid).toBe(true);
    expect(res.invalidCodes.sort()).toEqual(["D29", "EF67LP99"]);
  });
});

describe("filterWithRetry — fluxo fail-visible completo", () => {
  it("não chama regenerate quando há sugestões válidas na primeira passada", async () => {
    const regenerate = vi.fn();
    const res = await filterWithRetry([sug("ok", "Usar EF89EF03")], ALLOWED, regenerate);
    expect(regenerate).not.toHaveBeenCalled();
    expect(res.precisaRevisao).toBe(false);
    expect(res.sugestoes.map((s) => s.id)).toEqual(["ok"]);
  });

  it("regenera UMA vez com os códigos inválidos no prompt de correção", async () => {
    const regenerate = vi.fn().mockResolvedValue([sug("retry-ok", "Usar EF15LP01")]);
    const res = await filterWithRetry([sug("bad", "Usar EF67LP99")], ALLOWED, regenerate);

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith(buildCorrecaoPrompt(["EF67LP99"]));
    expect(regenerate.mock.calls[0][0]).toContain("EF67LP99");
    expect(res.precisaRevisao).toBe(false);
    expect(res.sugestoes.map((s) => s.id)).toEqual(["retry-ok"]);
  });

  it("marca precisaRevisao quando a regeneração TAMBÉM cita código inventado", async () => {
    const regenerate = vi.fn().mockResolvedValue([
      sug("still-bad", "Usar EF67LP99 de novo"),
      sug("also-bad", "Usar EM13ZZZ999"),
    ]);
    const res = await filterWithRetry([sug("bad", "Usar EF67LP99")], ALLOWED, regenerate);

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(res.precisaRevisao).toBe(true);
    // nunca fail-open: as sugestões voltam, mas TODAS marcadas para revisão
    expect(res.sugestoes).toHaveLength(2);
    expect(res.sugestoes.every((s) => s.precisaRevisao === true)).toBe(true);
  });

  it("marca precisaRevisao no lote original quando a regeneração lança erro", async () => {
    const regenerate = vi.fn().mockRejectedValue(new Error("provider indisponível"));
    const res = await filterWithRetry([sug("bad", "Usar EF67LP99")], ALLOWED, regenerate);

    expect(res.precisaRevisao).toBe(true);
    expect(res.sugestoes.map((s) => s.id)).toEqual(["bad"]);
    expect(res.sugestoes[0].precisaRevisao).toBe(true);
  });

  it("passa tudo adiante sem retry quando não há contexto (allowed set vazio)", async () => {
    const regenerate = vi.fn();
    const res = await filterWithRetry([sug("a", "Usar EF67LP99")], new Set(), regenerate);
    expect(regenerate).not.toHaveBeenCalled();
    expect(res.precisaRevisao).toBe(false);
    expect(res.sugestoes.map((s) => s.id)).toEqual(["a"]);
  });

  it("lote vazio não dispara retry e volta vazio marcado precisaRevisao", async () => {
    const regenerate = vi.fn();
    const res = await filterWithRetry([], ALLOWED, regenerate);
    expect(regenerate).not.toHaveBeenCalled();
    expect(res.sugestoes).toEqual([]);
    expect(res.precisaRevisao).toBe(true);
  });
});
