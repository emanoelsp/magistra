import "server-only";
import { getAdminDb } from "../firebase/admin";

export interface PedagogicMemory {
  user_id: string;
  metodologias: string[];      // most recurring methodologies detected
  tipos_avaliacao: string[];   // assessment types used
  componentes: string[];       // subjects taught
  etapas: string[];            // school stages (EF, EM)
  total_planos: number;
  updated_at: string;
}

const METHODOLOGY_KEYWORDS = [
  "aprendizagem baseada em projetos", "ABP", "sala de aula invertida",
  "gamificação", "aprendizagem cooperativa", "socialização",
  "resolução de problemas", "investigação", "aula expositiva dialogada",
  "rotação por estações", "sequência didática",
];

const ASSESSMENT_KEYWORDS = [
  "formativa", "somativa", "autoavaliação", "portfólio",
  "rubricas", "observação", "diagnóstica", "prova", "seminário",
];

function extractKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
}

function topN(items: string[], n = 3): string[] {
  const freq: Record<string, number> = {};
  for (const item of items) freq[item] = (freq[item] ?? 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

export async function updatePedagogicMemory(
  userId: string,
  planoConteudo: Record<string, unknown>,
  metadata: Record<string, string>,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("magis_perfil_pedagogico").doc(userId);

  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() as PedagogicMemory) : null;

  // Extract signals from this plan's content
  const allText = Object.values(planoConteudo).filter((v) => typeof v === "string").join(" ");
  const metodologias = extractKeywords(allText, METHODOLOGY_KEYWORDS);
  const tiposAvaliacao = extractKeywords(allText, ASSESSMENT_KEYWORDS);
  const componente = metadata.disciplina ?? metadata.componente ?? metadata.area ?? "";
  const etapa = metadata.etapa ?? metadata.nivel ?? "";

  // Merge with existing memory
  const prev = existing ?? { metodologias: [], tipos_avaliacao: [], componentes: [], etapas: [], total_planos: 0 };

  await ref.set({
    user_id: userId,
    metodologias: topN([...prev.metodologias, ...metodologias], 5),
    tipos_avaliacao: topN([...prev.tipos_avaliacao, ...tiposAvaliacao], 3),
    componentes: topN([...(prev.componentes ?? []), ...(componente ? [componente] : [])], 5),
    etapas: topN([...(prev.etapas ?? []), ...(etapa ? [etapa] : [])], 3),
    total_planos: (prev.total_planos ?? 0) + 1,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Returns a pedagogic memory string to inject into the IA prompt.
 * @param enriched Regente tier: lower activation threshold + more context depth.
 */
export async function getPedagogicMemoryContext(
  userId: string,
  enriched = false,
): Promise<string> {
  const db = getAdminDb();
  const snap = await db.collection("magis_perfil_pedagogico").doc(userId).get();

  if (!snap.exists) return "";

  const mem = snap.data() as PedagogicMemory;
  const minPlanos = enriched ? 1 : 3;
  if ((mem.total_planos ?? 0) < minPlanos) return "";

  const lines: string[] = [];

  if (enriched) {
    // Regente: richer profile context
    if (mem.componentes?.length)
      lines.push(`Componentes curriculares que leciona: ${mem.componentes.join(", ")}`);
    if (mem.etapas?.length)
      lines.push(`Etapas de ensino: ${mem.etapas.join(", ")}`);
    if (mem.metodologias?.length)
      lines.push(`Metodologias pedagógicas preferidas: ${mem.metodologias.join(", ")}`);
    if (mem.tipos_avaliacao?.length)
      lines.push(`Instrumentos de avaliação recorrentes: ${mem.tipos_avaliacao.join(", ")}`);
    if ((mem.total_planos ?? 0) > 0)
      lines.push(`Total de planos criados com a Magis: ${mem.total_planos}`);
    lines.push("Adapte sugestões ao perfil consolidado acima — priorize metodologias e instrumentos já familiares ao professor.");
  } else {
    // Mestre e abaixo: perfil básico
    if (mem.metodologias?.length)
      lines.push(`Metodologias preferidas: ${mem.metodologias.join(", ")}`);
    if (mem.tipos_avaliacao?.length)
      lines.push(`Tipos de avaliação recorrentes: ${mem.tipos_avaliacao.join(", ")}`);
    if (mem.componentes?.length)
      lines.push(`Componentes curriculares que leciona: ${mem.componentes.join(", ")}`);
    if (mem.etapas?.length)
      lines.push(`Etapas de ensino: ${mem.etapas.join(", ")}`);
  }

  if (lines.length === 0) return "";

  return `<perfil_pedagogico_do_professor>\n${lines.join("\n")}\n</perfil_pedagogico_do_professor>`;
}
