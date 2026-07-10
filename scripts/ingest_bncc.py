#!/usr/bin/env python3
"""
Ingestão da base BNCC para o Plano Magistral.
=============================================

Dois caminhos de entrada, convergindo no MESMO schema de saída:

  Caminho A (primário)  : planilha oficial/estruturada (.xlsx / .csv)
  Caminho B (fallback)  : PDF oficial da BNCC (pdfplumber + regex de segmentação)

Pipeline:
  extrair → normalizar → VALIDAR (cross-check determinístico via regex do código)
  → gravar JSONL de auditoria → embeddings em batch → upload Firestore.

Uso:
  python scripts/ingest_bncc.py planilha caminho/para/bncc.xlsx --componentes LP MA
  python scripts/ingest_bncc.py pdf caminho/para/BNCC_EI_EF.pdf --componentes LP MA
  python scripts/ingest_bncc.py upload saida/habilidades_validadas.jsonl --project meu-projeto

Dependências:
  pip install pandas openpyxl pdfplumber firebase-admin google-cloud-firestore

Critério de "pronto" (v1): LP + MA do Ensino Fundamental, campo `habilidade`
verbatim, validação cruzada passando, embeddings gerados.

O decompor_codigo() é o regex canônico do sistema — reutilizado pelo validador
closed-world na geração de planos (ver lib/ai/bncc-validator.ts quando for criado).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, asdict, field
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. GRAMÁTICA DOS CÓDIGOS BNCC (determinística — coração da validação)
# ---------------------------------------------------------------------------

# EF67LP08 → etapa=EF, anos="67", componente=LP, seq=08
RE_EF = re.compile(r"^EF(\d{2})([A-Z]{2})(\d{2})$")
# EI03EO01 → etapa=EI, faixa=03, campo de experiência=EO, seq=01
RE_EI = re.compile(r"^EI(\d{2})([A-Z]{2})(\d{2})$")
# EM13LGG101 → etapa=EM, "13" fixo, área=LGG, seq=101
RE_EM = re.compile(r"^EM13([A-Z]{3})(\d{3})$")

# Regex "solto" — encontra código no meio de texto (segmentação PDF + validador closed-world)
RE_ANY_CODE = re.compile(r"\((E[IFM]\d{2}[A-Z]{2,3}\d{2,3})\)")

COMPONENTES_EF = {
    "LP": ("Língua Portuguesa",   "Linguagens"),
    "AR": ("Arte",                "Linguagens"),
    "EF": ("Educação Física",     "Linguagens"),  # sigla colide com etapa; OK na posição de componente
    "LI": ("Língua Inglesa",      "Linguagens"),
    "MA": ("Matemática",          "Matemática"),
    "CI": ("Ciências",            "Ciências da Natureza"),
    "GE": ("Geografia",           "Ciências Humanas"),
    "HI": ("História",            "Ciências Humanas"),
    "ER": ("Ensino Religioso",    "Ensino Religioso"),
}

CAMPOS_EI = {
    "EO": "O eu, o outro e o nós",
    "CG": "Corpo, gestos e movimentos",
    "TS": "Traços, sons, cores e formas",
    "EF": "Escuta, fala, pensamento e imaginação",
    "ET": "Espaços, tempos, quantidades, relações e transformações",
}

AREAS_EM = {
    "LGG": "Linguagens e suas Tecnologias",
    "MAT": "Matemática e suas Tecnologias",
    "CNT": "Ciências da Natureza e suas Tecnologias",
    "CHS": "Ciências Humanas e Sociais Aplicadas",
}


def parse_anos_ef(digitos: str) -> list[int]:
    """'67'→[6,7]  '15'→[1..5]  '69'→[6..9]  '05'→[5]  '89'→[8,9]"""
    a, b = int(digitos[0]), int(digitos[1])
    if a == 0:
        return [b]
    if a < b:
        return list(range(a, b + 1))
    raise ValueError(f"faixa de anos inválida: {digitos}")


@dataclass
class CodigoDecomposto:
    codigo: str
    etapa: str
    anos: list[int]
    componente: str
    componente_nome: str
    area: str
    seq: int


def decompor_codigo(codigo: str) -> CodigoDecomposto:
    """Valida e decompõe um código BNCC. Levanta ValueError se inválido.
    Reutilizado pelo validador closed-world da geração (importar como canônico)."""
    codigo = codigo.strip().upper()

    if m := RE_EF.match(codigo):
        anos, comp, seq = m.groups()
        if comp not in COMPONENTES_EF:
            raise ValueError(f"{codigo}: componente EF desconhecido '{comp}'")
        nome, area = COMPONENTES_EF[comp]
        return CodigoDecomposto(codigo, "EF", parse_anos_ef(anos), comp, nome, area, int(seq))

    if m := RE_EI.match(codigo):
        faixa, campo, seq = m.groups()
        if campo not in CAMPOS_EI:
            raise ValueError(f"{codigo}: campo de experiência EI desconhecido '{campo}'")
        return CodigoDecomposto(codigo, "EI", [int(faixa)], campo, CAMPOS_EI[campo],
                                "Educação Infantil", int(seq))

    if m := RE_EM.match(codigo):
        area_sigla, seq = m.groups()
        if area_sigla not in AREAS_EM:
            raise ValueError(f"{codigo}: área EM desconhecida '{area_sigla}'")
        return CodigoDecomposto(codigo, "EM", [1, 2, 3], area_sigla,
                                AREAS_EM[area_sigla], AREAS_EM[area_sigla], int(seq))

    raise ValueError(f"código fora da gramática BNCC: {codigo}")


# ---------------------------------------------------------------------------
# 2. SCHEMA DE SAÍDA (o mesmo para os dois caminhos)
# ---------------------------------------------------------------------------

@dataclass
class Habilidade:
    codigo: str
    etapa: str
    anos: list[int]
    componente: str
    componente_nome: str
    area: str
    habilidade: str                       # texto VERBATIM do documento oficial
    verbo_nucleo: str = ""
    campo_atuacao: str | None = None      # LP
    pratica_linguagem: str | None = None  # LP
    unidade_tematica: str | None = None   # MA, CI, GE, HI
    objeto_conhecimento: str | None = None
    fonte: dict = field(default_factory=dict)
    status: str = "validado"              # validado | pendente_revisao
    problemas: list[str] = field(default_factory=list)


def extrair_verbo_nucleo(texto: str) -> str:
    """Primeira palavra após o (CÓDIGO) — na BNCC é sempre o verbo no infinitivo."""
    limpo = RE_ANY_CODE.sub("", texto).strip()
    primeira = limpo.split()[0] if limpo.split() else ""
    return primeira.rstrip(",").lower()


def normalizar_texto(t: str) -> str:
    """Normalização para comparação — não altera o texto gravado, que é verbatim."""
    t = unicodedata.normalize("NFKC", t)
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------------------
# 3. CAMINHO A — planilha oficial (.xlsx/.csv)
# ---------------------------------------------------------------------------

MAPA_COLUNAS = {
    "codigo": ["código", "codigo", "cod", "código da habilidade", "codigo_habilidade"],
    "habilidade": ["habilidade", "habilidades", "descrição da habilidade", "texto"],
    "unidade_tematica": ["unidade temática", "unidades temáticas", "unidade tematica"],
    "objeto_conhecimento": ["objeto de conhecimento", "objetos de conhecimento", "objeto do conhecimento"],
    "campo_atuacao": ["campo de atuação", "campos de atuação", "campo de atuacao"],
    "pratica_linguagem": ["prática de linguagem", "práticas de linguagem", "eixo"],
}


def _resolver_colunas(colunas: list[str]) -> dict[str, str]:
    res: dict[str, str] = {}
    normalizadas = {normalizar_texto(c).lower(): c for c in colunas}
    for campo, aliases in MAPA_COLUNAS.items():
        for alias in aliases:
            if alias in normalizadas:
                res[campo] = normalizadas[alias]
                break
    if "codigo" not in res or "habilidade" not in res:
        raise SystemExit(
            f"Não encontrei colunas de código/habilidade. Colunas da planilha: {colunas}\n"
            f"Adicione o nome real ao MAPA_COLUNAS."
        )
    return res


def ingestao_planilha(caminho: Path, componentes: set[str]) -> list[Habilidade]:
    import pandas as pd

    frames = []
    if caminho.suffix.lower() in (".xlsx", ".xlsm"):
        xls = pd.ExcelFile(caminho)
        for aba in xls.sheet_names:
            frames.append(pd.read_excel(xls, sheet_name=aba))
    else:
        frames.append(pd.read_csv(caminho))

    habilidades: list[Habilidade] = []
    for df in frames:
        df = df.dropna(how="all").ffill()
        try:
            cols = _resolver_colunas([str(c) for c in df.columns])
        except SystemExit:
            continue  # aba sem estrutura de habilidades (capa, sumário...)

        for _, row in df.iterrows():
            bruto = str(row[cols["codigo"]]).strip().upper()
            codigo = bruto.strip("()")
            try:
                dec = decompor_codigo(codigo)
            except ValueError:
                continue
            if componentes and dec.componente not in componentes:
                continue

            texto = normalizar_texto(str(row[cols["habilidade"]]))
            h = Habilidade(
                codigo=dec.codigo, etapa=dec.etapa, anos=dec.anos,
                componente=dec.componente, componente_nome=dec.componente_nome,
                area=dec.area, habilidade=texto,
                verbo_nucleo=extrair_verbo_nucleo(texto),
                unidade_tematica=_opt(row, cols, "unidade_tematica"),
                objeto_conhecimento=_opt(row, cols, "objeto_conhecimento"),
                campo_atuacao=_opt(row, cols, "campo_atuacao"),
                pratica_linguagem=_opt(row, cols, "pratica_linguagem"),
                fonte={"doc": caminho.name, "tipo": "planilha"},
            )
            habilidades.append(h)
    return habilidades


def _opt(row, cols: dict[str, str], campo: str) -> str | None:
    if campo not in cols:
        return None
    v = row[cols[campo]]
    v = normalizar_texto(str(v)) if v is not None else ""
    return v or None


# ---------------------------------------------------------------------------
# 4. CAMINHO B — PDF oficial (pdfplumber + regex de segmentação)
# ---------------------------------------------------------------------------

def ingestao_pdf(caminho: Path, componentes: set[str]) -> list[Habilidade]:
    """Passos 1-2: extração bruta + segmentação por código.
    Recupera código + texto verbatim (~95% dos casos). Metadados hierárquicos
    (unidade temática, objeto, campo de atuação) ficam None — preencher depois
    com enriquecimento LLM opcional, NUNCA tocando código/texto verbatim.
    """
    import pdfplumber

    habilidades: list[Habilidade] = []
    with pdfplumber.open(caminho) as pdf:
        for num, page in enumerate(pdf.pages, start=1):
            texto = page.extract_text() or ""
            texto = normalizar_texto(texto)

            matches = list(RE_ANY_CODE.finditer(texto))
            for i, m in enumerate(matches):
                codigo = m.group(1)
                try:
                    dec = decompor_codigo(codigo)
                except ValueError:
                    continue
                if componentes and dec.componente not in componentes:
                    continue

                fim = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
                corpo = texto[m.start():fim].strip()
                # corta lixo de rodapé/cabeçalho que vazou pro bloco
                corpo = re.split(r"\s(?:BASE NACIONAL COMUM CURRICULAR|\d{3}\s*$)", corpo)[0].strip()

                if len(corpo) < 25:
                    continue

                habilidades.append(Habilidade(
                    codigo=dec.codigo, etapa=dec.etapa, anos=dec.anos,
                    componente=dec.componente, componente_nome=dec.componente_nome,
                    area=dec.area, habilidade=corpo,
                    verbo_nucleo=extrair_verbo_nucleo(corpo),
                    fonte={"doc": caminho.name, "tipo": "pdf", "pagina": num},
                    status="pendente_revisao" if i + 1 >= len(matches) else "validado",
                ))
    return _dedup_pdf(habilidades)


def _dedup_pdf(hs: list[Habilidade]) -> list[Habilidade]:
    """O PDF repete habilidades entre seções. Mantém o texto mais longo (menos truncado)."""
    por_codigo: dict[str, Habilidade] = {}
    for h in hs:
        atual = por_codigo.get(h.codigo)
        if atual is None or len(h.habilidade) > len(atual.habilidade):
            por_codigo[h.codigo] = h
    return list(por_codigo.values())


# ---------------------------------------------------------------------------
# 5. VALIDAÇÃO CRUZADA (passo 4 — roda para os DOIS caminhos)
# ---------------------------------------------------------------------------

def validar(habilidades: list[Habilidade]) -> tuple[list[Habilidade], dict]:
    relatorio: dict = {"total": len(habilidades), "ok": 0, "revisao": 0, "erros": []}

    vistos: set[str] = set()
    for h in habilidades:
        problemas = []

        dec = decompor_codigo(h.codigo)
        if dec.componente != h.componente:
            problemas.append(f"componente divergente: código diz {dec.componente}")

        if h.codigo not in h.habilidade:
            problemas.append("texto não contém o código — possível truncamento")

        if not h.verbo_nucleo.endswith("r"):
            problemas.append(f"verbo núcleo suspeito: '{h.verbo_nucleo}'")

        if h.codigo in vistos:
            problemas.append("código duplicado no lote")
        vistos.add(h.codigo)

        if problemas:
            h.status = "pendente_revisao"
            h.problemas = problemas
            relatorio["revisao"] += 1
            relatorio["erros"].append({"codigo": h.codigo, "problemas": problemas})
        else:
            relatorio["ok"] += 1

    contagem = Counter(h.componente for h in habilidades)
    relatorio["contagem_por_componente"] = dict(contagem)
    for comp, minimo in {"LP": 200, "MA": 150}.items():
        if comp in contagem and contagem[comp] < minimo:
            relatorio["erros"].append({
                "codigo": f"*{comp}",
                "problemas": [f"apenas {contagem[comp]} habilidades — esperado ≥{minimo}; verifique extração"]
            })
    return habilidades, relatorio


# ---------------------------------------------------------------------------
# 6. EMBEDDINGS (batch, plugável) + UPLOAD FIRESTORE
# ---------------------------------------------------------------------------

def texto_para_embedding(h: Habilidade) -> str:
    """Concatenação que maximiza a semântica para busca vetorial."""
    partes = [p for p in [h.objeto_conhecimento, h.unidade_tematica, h.habilidade] if p]
    return " | ".join(partes)


def gerar_embeddings_gemini(habilidades: list[Habilidade], api_key: str) -> list[list[float]]:
    """
    Gera embeddings via Gemini embedding-001 (mesma config usada pelo bncc-rag.server.ts).
    Faz chamadas em batches de 100 textos (limite da API batch).

    Dependências: pip install requests
    """
    import time
    import urllib.request

    ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key={api_key}"
    BATCH = 100
    DELAY = 0.5  # 500 ms entre batches para evitar quota 429

    textos = [texto_para_embedding(h) for h in habilidades]
    all_embeddings: list[list[float]] = []

    for i in range(0, len(textos), BATCH):
        chunk = textos[i : i + BATCH]
        payload = json.dumps({
            "requests": [
                {"model": "models/gemini-embedding-001", "content": {"parts": [{"text": t}]}}
                for t in chunk
            ]
        }).encode("utf-8")

        req = urllib.request.Request(ENDPOINT, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")

        tries = 0
        while True:
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    body = json.loads(resp.read())
                    for item in body.get("embeddings", []):
                        all_embeddings.append(item.get("values", []))
                break
            except Exception as e:
                tries += 1
                if tries >= 3:
                    raise RuntimeError(f"Erro Gemini batch embeddings após {tries} tentativas: {e}") from e
                wait = 2 ** tries
                print(f"  Retry {tries} após {wait}s ({e})…")
                time.sleep(wait)

        print(f"  Embeddings: {len(all_embeddings)}/{len(textos)}")
        if i + BATCH < len(textos):
            time.sleep(DELAY)

    return all_embeddings


# Mantido para compatibilidade — chama a implementação Gemini quando GEMINI_API_KEY estiver no env
def gerar_embeddings(habilidades: list[Habilidade]) -> list[list[float]]:
    import os
    key = os.environ.get("GOOGLE_GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise EnvironmentError(
            "GOOGLE_GEMINI_API_KEY não encontrada. "
            "Exporte a variável ou rode upload com --sem-embeddings."
        )
    return gerar_embeddings_gemini(habilidades, key)


def upload_pinecone(jsonl: Path, index_name: str, namespace: str = "bncc") -> None:
    """
    Envia habilidades para o Pinecone (destino que o bncc-rag.server.ts lê).

    Usa a mesma estrutura de metadados que o script TypeScript ingest-bncc.ts
    para que os filtros de componente/etapa funcionem igual.

    Dependências: pip install pinecone-client requests
    """
    import os
    try:
        from pinecone import Pinecone  # type: ignore[import]
    except ImportError:
        raise ImportError("pip install pinecone-client") from None

    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        raise EnvironmentError("PINECONE_API_KEY não encontrada.")

    habilidades = [Habilidade(**json.loads(l)) for l in jsonl.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(f"Gerando embeddings para {len(habilidades)} habilidades…")
    embeddings = gerar_embeddings(habilidades)

    pc = Pinecone(api_key=api_key)
    idx = pc.Index(index_name)

    UPSERT_BATCH = 100
    n = 0
    for i in range(0, len(habilidades), UPSERT_BATCH):
        chunk_h = habilidades[i : i + UPSERT_BATCH]
        chunk_e = embeddings[i : i + UPSERT_BATCH]
        vectors = []
        for h, emb in zip(chunk_h, chunk_e):
            vectors.append({
                "id":       h.codigo,
                "values":   emb,
                "metadata": {
                    "codigo":      h.codigo,
                    "texto":       h.habilidade,
                    "componente":  h.componente,
                    "area":        h.area,
                    "etapa":       h.etapa,
                    "anos":        h.anos or "",
                    "fonte":       "BNCC",
                },
            })
        idx.upsert(vectors=vectors, namespace=namespace)
        n += len(vectors)
        print(f"  Upsertado: {n}/{len(habilidades)}")

    print(f"✓ {n} habilidades no Pinecone — índice={index_name} namespace={namespace}")


def upload_firestore(jsonl: Path, project: str, com_embeddings: bool) -> None:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud.firestore_v1.vector import Vector

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.ApplicationDefault(), {"projectId": project})
    db = firestore.client()

    habilidades = [Habilidade(**json.loads(l)) for l in jsonl.read_text(encoding="utf-8").splitlines() if l.strip()]

    embeddings = None
    if com_embeddings:
        embeddings = gerar_embeddings(habilidades)

    batch, n = db.batch(), 0
    for i, h in enumerate(habilidades):
        doc = asdict(h)
        doc.pop("problemas", None)
        if embeddings:
            doc["embedding"] = Vector(embeddings[i])
        # doc ID = código → validação closed-world vira getAll() O(1) por código
        batch.set(db.collection("bncc_habilidades").document(h.codigo), doc)
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = db.batch()
            print(f"  {n} gravados...")
    batch.commit()
    print(f"✓ {n} habilidades gravadas em bncc_habilidades/")


# ---------------------------------------------------------------------------
# 7. CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Ingestão BNCC — Plano Magistral")
    sub = ap.add_subparsers(dest="cmd", required=True)

    for nome in ("planilha", "pdf"):
        p = sub.add_parser(nome)
        p.add_argument("arquivo", type=Path)
        p.add_argument("--componentes", nargs="*", default=["LP", "MA"],
                       help="siglas EF a ingerir (default: LP MA)")
        p.add_argument("--saida", type=Path, default=Path("saida"))

    up = sub.add_parser("upload")
    up.add_argument("jsonl", type=Path)
    up.add_argument("--project", required=True)
    up.add_argument("--sem-embeddings", action="store_true")

    upc = sub.add_parser("upload-pinecone",
        help="Gera embeddings Gemini e faz upsert no Pinecone (destino do RAG em prod)")
    upc.add_argument("jsonl", type=Path)
    upc.add_argument("--index", default="bncc", help="Nome do índice Pinecone (default: bncc)")
    upc.add_argument("--namespace", default="bncc", help="Namespace dentro do índice (default: bncc)")

    args = ap.parse_args()

    if args.cmd == "upload":
        upload_firestore(args.jsonl, args.project, com_embeddings=not args.sem_embeddings)
        return

    if args.cmd == "upload-pinecone":
        upload_pinecone(args.jsonl, args.index, args.namespace)
        return

    comps = set(c.upper() for c in args.componentes)
    fn = ingestao_planilha if args.cmd == "planilha" else ingestao_pdf
    habilidades = fn(args.arquivo, comps)
    habilidades, relatorio = validar(habilidades)

    args.saida.mkdir(parents=True, exist_ok=True)
    ok_path  = args.saida / "habilidades_validadas.jsonl"
    rev_path = args.saida / "habilidades_revisao.jsonl"
    rel_path = args.saida / "relatorio.json"

    with ok_path.open("w", encoding="utf-8") as f_ok, rev_path.open("w", encoding="utf-8") as f_rev:
        for h in habilidades:
            linha = json.dumps(asdict(h), ensure_ascii=False)
            (f_ok if h.status == "validado" else f_rev).write(linha + "\n")

    rel_path.write_text(json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ {relatorio['ok']} validadas → {ok_path}")
    print(f"⚠ {relatorio['revisao']} para revisão → {rev_path}")
    print(f"  relatório: {rel_path}")
    print(f"  contagem: {relatorio['contagem_por_componente']}")


if __name__ == "__main__":
    main()
