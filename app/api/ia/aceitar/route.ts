import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";

// Feedback implícito de qualidade do RAG: capturado no save, não interrompe o professor.
interface FeedbackEntry {
  fieldKey: string;
  sugestaoId: string;
  fonte: string;          // ex: "BNCC EF06MA01", "SAEB D01", "currículo territorial"
  outcome: "accepted" | "expanded" | "replaced";
  injectedLen: number;
  finalLen: number;
  msSinceInject: number;
}

// Deriva o namespace RAG a partir do campo "fonte" da sugestão.
// Permite agrupar acurácia por corpus sem armazenar o texto bruto.
function inferNamespace(fonte: string): string {
  const f = fonte.toLowerCase();
  if (/\bef\d{2}|em\d{2}/.test(f) || f.startsWith("bncc") || f.startsWith("competência")) return "bncc";
  if (f.includes("saeb") || /d\d{2}/.test(f)) return "saeb";
  if (f.includes("territorial") || f.includes("estadual") || f.includes("currícul")) return "curriculo_estadual";
  if (f.includes("técnico") || f.includes("cnct") || f.includes("eixo")) return "cnct";
  if (f.includes("digital") || f.includes("computação") || f.includes("co\d")) return "curriculo_digital";
  return "unknown";
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as {
      templateId?: string;
      fieldKey?: string;
      sugestaoId?: string;
      tipo?: "titulo" | "completo";
      feedback?: FeedbackEntry[];
    };

    const { templateId, fieldKey, sugestaoId, tipo, feedback } = body;

    const db = getAdminDb();
    const batch = db.batch();

    // ── Caminho 1: evento de aceitação imediata (legado — mantido) ────────────
    if (templateId && fieldKey && sugestaoId) {
      const ref = db.collection("magis_usage_logs").doc();
      batch.set(ref, {
        user_id: user.uid,
        action: "sugestao_aceita",
        template_id: templateId,
        field_key: fieldKey,
        sugestao_id: sugestaoId,
        tipo: tipo ?? "completo",
        timestamp: new Date().toISOString(),
      });
    }

    // ── Caminho 2: feedback implícito de qualidade (batch no save) ────────────
    if (templateId && Array.isArray(feedback) && feedback.length > 0) {
      for (const entry of feedback.slice(0, 20)) { // teto: 20 campos por save
        if (!entry.fieldKey || !entry.outcome) continue;
        const ref = db.collection("rag_feedback").doc();
        batch.set(ref, {
          user_id:           user.uid,
          template_id:       templateId,
          field_key:         entry.fieldKey,
          sugestao_id:       entry.sugestaoId,
          fonte:             entry.fonte,
          namespace:         inferNamespace(entry.fonte),
          outcome:           entry.outcome,          // "accepted" | "expanded" | "replaced"
          injected_len:      entry.injectedLen,
          final_len:         entry.finalLen,
          ms_since_inject:   entry.msSinceInject,
          timestamp:         new Date().toISOString(),
        });
      }
    }

    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // nunca falha o cliente em telemetria
  }
}
