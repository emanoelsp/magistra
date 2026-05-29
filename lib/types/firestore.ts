export type TemplateFieldKind =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "number"
  | "date";

export type TemplateFieldRole = "manual" | "ia_sugerida";

export type TemplateFieldGroup =
  | "dados_turma"
  | "objetivos"
  | "competencias"
  | "habilidades"
  | "conteudos"
  | "avaliacao"
  | "outros";

export interface TemplateFieldSchema {
  key: string;
  label: string;
  type: TemplateFieldKind;
  required: boolean;
  role?: TemplateFieldRole;
  group?: TemplateFieldGroup;
  placeholder?: string;
  helperText?: string;
  options?: string[];
  aiInstructions?: string;
  defaultValue?: string;
}

export interface UserProfile {
  uid: string;
  nome: string;
  email: string;
  escola_padrao: string | null;
  plano: string;
  plano_validade: string | null;
  tokens_usados_mes: number;
}

export interface TemplateRecord {
  id: string;
  user_id: string;
  nome: string;
  escola_nome?: string | null;
  tipo_plano?: string | null;
  schema_campos: TemplateFieldSchema[];
  data_criacao: string;
  metadata_padrao?: Record<string, string>;
  arquivo_url?: string;
  arquivo_fillable_url?: string;
}

export interface CreateTemplateInput {
  user_id: string;
  nome: string;
  escola_nome?: string;
  tipo_plano?: string;
  schema_campos: TemplateFieldSchema[];
  data_criacao?: string;
}

export interface UpdateTemplateInput {
  nome?: string;
  schema_campos?: TemplateFieldSchema[];
  metadata_padrao?: Record<string, string>;
}

export type PlanoStatus =
  | "rascunho"
  | "aguardando_geracao"
  | "aguardando_aprovacao"
  | "processando"
  | "gerado"
  | "erro";

export interface PlanoRecord {
  id: string;
  user_id: string;
  template_id: string;
  conteudo_gerado: Record<string, unknown>;
  data_geracao: string;
  status: PlanoStatus;
  schema_campos?: TemplateFieldSchema[];
}

export interface CreatePlanoInput {
  user_id: string;
  template_id: string;
  conteudo_gerado: Record<string, unknown>;
  status: PlanoStatus;
  data_geracao?: string;
  schema_campos?: TemplateFieldSchema[];
}

export interface UpdatePlanoInput {
  template_id?: string;
  conteudo_gerado?: Record<string, unknown>;
  status?: PlanoStatus;
}

export interface DashboardStats {
  totalTemplates: number;
  totalPlanos: number;
  planosGeradosMes: number;
  planosPendentes: number;
  tokensUsadosMes: number;
  planoAtual: string;
}

export interface TemplateOption {
  id: string;
  nome: string;
  escolaNome?: string | null;
  tipoPlano?: string | null;
  campoCount: number;
  criadoEm: string;
  schema_campos?: TemplateFieldSchema[];
  metadata_padrao?: Record<string, string>;
  arquivo_url?: string;
}

export interface IaSugestao {
  id: string;
  label: string;
  descricao?: string;
  fonte?: string;
}

export type UsageAction = "introspect" | "ia_campo" | "gerar_plano";

export interface UsageLog {
  id: string;
  user_id: string;
  action: UsageAction;
  model: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cost_usd: number;
  timestamp: string;
  metadata?: {
    template_id?: string;
    plano_id?: string;
    field_key?: string;
  };
}

export interface AdminConfig {
  vercel_monthly_usd: number;
  firebase_monthly_usd: number;
  other_monthly_usd: number;
  gemini_input_cost_per_1m: number;
  gemini_output_cost_per_1m: number;
  updated_at: string;
}

export interface GerarPlanoWizardValues {
  templateId: string;
  nomeTurma: string;
  etapaEnsino: "Educação Infantil" | "Ensino Fundamental" | "Ensino Médio";
  anoSerie: string;
  componenteCurricular: string;
  quantidadeAulas: number;
  contextoTurma: string;
  objetivoGeral: string;
  habilidadesBncc: string;
  referenciaSaeb: string;
  observacoes: string;
  aprovacaoIA: boolean;
}
