import "server-only";

import { NextResponse } from "next/server";
import mammoth from "mammoth";
import pdf from "pdf-parse";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getAdminDb } from "../../../lib/firebase/admin";
import { callAIWithFallbacks } from "../../../lib/ai/provider";
import type { DisciplinaBlock, PlanoRegenteConteudo, PlanoRegenteRecord } from "../../../lib/types/firestore";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS_PER_FILE = 8000;

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase().split("?")[0];
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  const data = await pdf(buffer);
  return data.text;
}

function parseRegenteJson(raw: string): { disciplina: string; professor?: string; conteudo: PlanoRegenteConteudo } | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const conteudo = (typeof parsed.conteudo === "object" && parsed.conteudo !== null ? parsed.conteudo : {}) as Record<string, unknown>;
    return {
      disciplina: typeof parsed.disciplina === "string" && parsed.disciplina.trim() ? parsed.disciplina.trim() : "Não identificado",
      professor: typeof parsed.professor === "string" && parsed.professor.trim() ? parsed.professor.trim() : undefined,
      conteudo: {
        objetivos: typeof conteudo.objetivos === "string" ? conteudo.objetivos : undefined,
        competencias: typeof conteudo.competencias === "string" ? conteudo.competencias : undefined,
        habilidades: typeof conteudo.habilidades === "string" ? conteudo.habilidades : undefined,
        conteudos: typeof conteudo.conteudos === "string" ? conteudo.conteudos : undefined,
        avaliacao: typeof conteudo.avaliacao === "string" ? conteudo.avaliacao : undefined,
        metodologia: typeof conteudo.metodologia === "string" ? conteudo.metodologia : undefined,
        outros: typeof conteudo.outros === "string" ? conteudo.outros : undefined,
      },
    };
  } catch {
    return null;
  }
}

const SYSTEM_INSTRUCAO = `Você é especialista em análise de planos de aula brasileiros da educação básica.
Dado o texto bruto de um plano de aula, extraia as informações pedagógicas estruturadas.
Responda APENAS com JSON válido, sem markdown, sem explicações.`;

function buildExtractionPrompt(text: string): string {
  return `Analise o plano de aula abaixo e extraia as informações em JSON com esta estrutura exata:

{
  "disciplina": "nome do componente curricular/disciplina",
  "professor": "nome do professor (null se não encontrado)",
  "conteudo": {
    "objetivos": "objetivos de aprendizagem (texto completo, null se não encontrado)",
    "competencias": "competências listadas (texto completo, null se não encontrado)",
    "habilidades": "habilidades BNCC ou similares (texto completo, null se não encontrado)",
    "conteudos": "conteúdos programáticos ou temáticos (texto completo, null se não encontrado)",
    "avaliacao": "formas de avaliação descritas (texto completo, null se não encontrado)",
    "metodologia": "estratégias e metodologias de ensino (texto completo, null se não encontrado)",
    "outros": "outras informações relevantes não categorizadas acima (null se não houver)"
  }
}

REGRAS:
- Extraia apenas o que está explicitamente no texto. Nunca invente.
- Use null para campos ausentes (não use string vazia).
- disciplina: componente curricular do plano (ex: "Matemática", "Língua Portuguesa", "Ciências").
- Se houver múltiplas disciplinas, use a principal.

TEXTO DO PLANO:
${text}`;
}

// GET — lista todos os planos regente do usuário
export async function GET() {
  try {
    const user = await requireCurrentUserProfile();
    const db = getAdminDb();
    const snap = await db.collection("magis_planos_regente").where("user_id", "==", user.uid).get();
    const planos = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          user_id: user.uid,
          disciplina: typeof d.disciplina === "string" ? d.disciplina : "Não identificado",
          professor: typeof d.professor === "string" ? d.professor : undefined,
          arquivo_nome: typeof d.arquivo_nome === "string" ? d.arquivo_nome : "",
          conteudo: (typeof d.conteudo === "object" && d.conteudo !== null ? d.conteudo : {}) as PlanoRegenteConteudo,
          criado_em: typeof d.criado_em === "string" ? d.criado_em : "",
          usado_por_pei: Array.isArray(d.usado_por_pei) ? (d.usado_por_pei as string[]) : [],
        } satisfies PlanoRegenteRecord;
      })
      .sort((a, b) => a.disciplina.localeCompare(b.disciplina, "pt-BR"));
    return NextResponse.json({ planos });
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
}

function parsedToBlock(parsed: { disciplina: string; professor?: string; conteudo: PlanoRegenteConteudo }, arquivo_nome: string): DisciplinaBlock {
  const c = parsed.conteudo;
  return {
    disciplina: parsed.disciplina,
    professor: parsed.professor ?? "",
    arquivo_nome,
    habilidades_turma: c.habilidades ?? "",
    objeto_conhecimento_turma: c.conteudos ?? "",
    competencias_turma: c.competencias ?? "",
    objetivos_turma: c.objetivos ?? "",
    avaliacao_turma: c.avaliacao ?? "",
    metodologia_turma: c.metodologia ?? "",
    habilidades_estudante: "",
    objeto_conhecimento_estudante: "",
    avaliacao_estudante: "",
  };
}

// POST — faz upload de múltiplos arquivos, extrai conteúdo via IA
// Quando ?nosave=true, retorna DisciplinaBlock[] sem persistir no Firestore
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const url = new URL(request.url);
    const nosave = url.searchParams.get("nosave") === "true";

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    const db = nosave ? null : getAdminDb();
    const criado_em = new Date().toISOString();
    const results: PlanoRegenteRecord[] = [];
    const blocos: DisciplinaBlock[] = [];
    const errors: { arquivo: string; erro: string }[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        errors.push({ arquivo: file.name, erro: "Arquivo excede 10 MB." });
        continue;
      }
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".pdf") && !lower.endsWith(".docx") && !lower.endsWith(".doc")) {
        errors.push({ arquivo: file.name, erro: "Formato não suportado (use PDF ou DOCX)." });
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        let text = await extractText(buffer, file.name);
        if (!text.trim()) {
          errors.push({ arquivo: file.name, erro: "Não foi possível extrair texto." });
          continue;
        }
        if (text.length > MAX_CHARS_PER_FILE) {
          text = text.slice(0, MAX_CHARS_PER_FILE) + "\n[… texto truncado …]";
        }

        const aiResult = await callAIWithFallbacks({
          systemInstruction: SYSTEM_INSTRUCAO,
          prompt: buildExtractionPrompt(text),
          temperature: 0.1,
        });

        const parsed = parseRegenteJson(aiResult.text);
        if (!parsed) {
          errors.push({ arquivo: file.name, erro: "IA não retornou JSON válido." });
          continue;
        }

        if (nosave) {
          blocos.push(parsedToBlock(parsed, file.name));
        } else {
          const ref = db!.collection("magis_planos_regente").doc();
          const record: Omit<PlanoRegenteRecord, "id"> = {
            user_id: user.uid,
            disciplina: parsed.disciplina,
            professor: parsed.professor,
            arquivo_nome: file.name,
            conteudo: parsed.conteudo,
            criado_em,
            usado_por_pei: [],
          };
          await ref.set(record);
          results.push({ id: ref.id, ...record });
        }
      } catch (err) {
        errors.push({ arquivo: file.name, erro: err instanceof Error ? err.message : "Erro ao processar." });
      }
    }

    if (nosave) {
      return NextResponse.json({ ok: true, blocos, errors });
    }
    return NextResponse.json({ ok: true, planos: results, errors });
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
}
