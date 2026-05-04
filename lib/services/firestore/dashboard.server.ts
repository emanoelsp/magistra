import "server-only";

import { getAdminDb } from "../../firebase/admin";
import type {
  DashboardStats,
  PlanoRecord,
  PlanoStatus,
  TemplateFieldSchema,
  TemplateOption,
  UserProfile,
} from "../../types/firestore";

const pendingStatuses = new Set<PlanoStatus>([
  "rascunho",
  "aguardando_geracao",
  "aguardando_aprovacao",
  "processando",
]);

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

function toIsoString(value: unknown): string {
  return toDate(value)?.toISOString() ?? new Date().toISOString();
}

function formatPlanLabel(plan: string): string {
  const normalizedPlan = plan.trim();

  if (!normalizedPlan) {
    return "Free";
  }

  return normalizedPlan
    .split(/[\s_-]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

export async function getDashboardStats(user: UserProfile): Promise<DashboardStats> {
  const adminDb = getAdminDb();
  const [templatesSnapshot, planosSnapshot] = await Promise.all([
    adminDb.collection("templates").where("user_id", "==", user.uid).get(),
    adminDb.collection("planos").where("user_id", "==", user.uid).get(),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let planosGeradosMes = 0;
  let planosPendentes = 0;

  for (const documentSnapshot of planosSnapshot.docs) {
    const planoData = documentSnapshot.data();
    const status = typeof planoData.status === "string" ? (planoData.status as PlanoStatus) : "rascunho";
    const generatedAt = toDate(planoData.data_geracao);

    if (generatedAt && generatedAt >= monthStart && status === "gerado") {
      planosGeradosMes += 1;
    }

    if (pendingStatuses.has(status)) {
      planosPendentes += 1;
    }
  }

  return {
    totalTemplates: templatesSnapshot.size,
    planosGeradosMes,
    planosPendentes,
    tokensUsadosMes: user.tokens_usados_mes,
    planoAtual: formatPlanLabel(user.plano),
  };
}

export async function getUserTemplateOptions(userId: string): Promise<TemplateOption[]> {
  const adminDb = getAdminDb();
  const templatesSnapshot = await adminDb.collection("templates").where("user_id", "==", userId).get();

  return templatesSnapshot.docs
    .map((documentSnapshot) => {
      const templateData = documentSnapshot.data();
      const rawSchema = templateData.schema_campos;
      const schema: TemplateFieldSchema[] = Array.isArray(rawSchema)
        ? rawSchema.map((item: unknown) => {
            const obj = item as Record<string, unknown>;
            return {
              key: typeof obj.key === "string" ? obj.key : "",
              label: typeof obj.label === "string" ? obj.label : "",
              type: (typeof obj.type === "string" ? obj.type : "text") as TemplateFieldSchema["type"],
              required: typeof obj.required === "boolean" ? obj.required : false,
              role: typeof obj.role === "string" ? (obj.role as TemplateFieldSchema["role"]) : undefined,
              group: typeof obj.group === "string" ? (obj.group as TemplateFieldSchema["group"]) : undefined,
              placeholder: typeof obj.placeholder === "string" ? obj.placeholder : undefined,
              helperText: typeof obj.helperText === "string" ? obj.helperText : undefined,
              options: Array.isArray(obj.options) ? (obj.options as string[]) : undefined,
            };
          })
        : [];

      const rawMeta = templateData.metadata_padrao;
      const metadata_padrao: Record<string, string> | undefined =
        rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
          ? (rawMeta as Record<string, string>)
          : undefined;

      return {
        id: documentSnapshot.id,
        nome: typeof templateData.nome === "string" ? templateData.nome : "Template sem nome",
        escolaNome:
          typeof templateData.escola_nome === "string" && templateData.escola_nome.length > 0
            ? templateData.escola_nome
            : null,
        tipoPlano:
          typeof templateData.tipo_plano === "string" && templateData.tipo_plano.length > 0
            ? templateData.tipo_plano
            : null,
        campoCount: schema.length,
        criadoEm: toIsoString(templateData.data_criacao),
        schema_campos: schema,
        metadata_padrao,
        arquivo_url:
          typeof templateData.arquivo_url === "string" ? templateData.arquivo_url : undefined,
      };
    })
    .sort((left, right) => right.criadoEm.localeCompare(left.criadoEm));
}

export async function getUserPlanos(userId: string): Promise<PlanoRecord[]> {
  const adminDb = getAdminDb();
  const snapshot = await adminDb.collection("planos").where("user_id", "==", userId).get();

  return snapshot.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        user_id: typeof d.user_id === "string" ? d.user_id : "",
        template_id: typeof d.template_id === "string" ? d.template_id : "",
        conteudo_gerado:
          typeof d.conteudo_gerado === "object" && d.conteudo_gerado !== null
            ? (d.conteudo_gerado as Record<string, unknown>)
            : {},
        data_geracao: toIsoString(d.data_geracao),
        status: (typeof d.status === "string" ? d.status : "rascunho") as PlanoStatus,
      };
    })
    .sort((a, b) => b.data_geracao.localeCompare(a.data_geracao));
}

export interface PlanoComNome extends PlanoRecord {
  template_nome: string;
  escola_nome: string | null;
}

export async function getUserPlanosComNome(
  userId: string,
  limit = 50,
): Promise<PlanoComNome[]> {
  const adminDb = getAdminDb();
  const snapshot = await adminDb.collection("planos").where("user_id", "==", userId).get();

  const planos = snapshot.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        user_id: typeof d.user_id === "string" ? d.user_id : "",
        template_id: typeof d.template_id === "string" ? d.template_id : "",
        conteudo_gerado:
          typeof d.conteudo_gerado === "object" && d.conteudo_gerado !== null
            ? (d.conteudo_gerado as Record<string, unknown>)
            : {},
        data_geracao: toIsoString(d.data_geracao),
        status: (typeof d.status === "string" ? d.status : "rascunho") as PlanoStatus,
      };
    })
    .sort((a, b) => b.data_geracao.localeCompare(a.data_geracao))
    .slice(0, limit);

  // Fetch template names in one batch
  const templateIds = [...new Set(planos.map((p) => p.template_id))];
  const templateNames: Record<string, { nome: string; escola_nome: string | null }> = {};

  await Promise.all(
    templateIds.map(async (tid) => {
      if (!tid) return;
      const tSnap = await adminDb.collection("templates").doc(tid).get();
      if (tSnap.exists) {
        const td = tSnap.data()!;
        templateNames[tid] = {
          nome: typeof td.nome === "string" ? td.nome : "Template sem nome",
          escola_nome: typeof td.escola_nome === "string" ? td.escola_nome : null,
        };
      }
    }),
  );

  return planos.map((p) => ({
    ...p,
    template_nome: templateNames[p.template_id]?.nome ?? "Template removido",
    escola_nome: templateNames[p.template_id]?.escola_nome ?? null,
  }));
}
