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

/**
 * Structural hint that tells injectPlaceholders HOW to place this field in the
 * DOCX XML. Set by the AI during introspection and used as a priority signal
 * over the generic label-matching passes. Mirrors StructuralPair.pattern.
 */
export type InjectionPattern =
  | "adjacent_right"   // value cell is immediately to the right of the label cell
  | "adjacent_below"   // value cell is in the next row below the label
  | "inline_colon"     // "Label: {{value}}" within the same cell/paragraph
  | "column_header"    // label is a column header; value rows follow below
  | "period_column";   // trimester/bimester sparse matrix column

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
  /** Structural hint from the AI introspection step — how to locate this field's cell. */
  injection_pattern?: InjectionPattern;
  /** AI's confidence in this field's identity and position (0–1). Set during introspection. */
  ai_confidence?: number;
}

export interface UserProfile {
  uid: string;
  nome: string;
  email: string;
  escola_padrao: string | null;
  plano: string;
  plano_validade: string | null;
  tokens_usados_mes: number;
  avulso_templates?: number;
  avulso_planos?: number;
  role?: "admin" | "professor";
  data_criacao?: string;
}

export type TemplateFillableStatus = "processando" | "pronto" | "erro";

export interface TemplateRecord {
  id: string;
  user_id: string;
  nome: string;
  escola_nome?: string | null;
  tipo_plano?: string | null;
  estado?: string | null;
  schema_campos: TemplateFieldSchema[];
  data_criacao: string;
  metadata_padrao?: Record<string, string>;
  arquivo_url?: string;
  arquivo_fillable_url?: string;
  fillable_status?: TemplateFillableStatus;
  /** Persisted cell-click positions (cellText + ordinal) keyed by field key. */
  field_positions?: Record<string, { cellText: string; ordinal: number }>;
  /** Fields whose label has no structural backing in the deterministic scan — need manual review. */
  campos_baixa_confianca?: string[];
  deleted_at?: string;
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
  downloads?: number;
  /** Snapshotted at finalization so download survives template deletion or file replacement. */
  arquivo_url?: string;
  arquivo_fillable_url?: string;
}

export interface CreatePlanoInput {
  user_id: string;
  template_id: string;
  conteudo_gerado: Record<string, unknown>;
  status: PlanoStatus;
  data_geracao?: string;
  schema_campos?: TemplateFieldSchema[];
  arquivo_url?: string;
  arquivo_fillable_url?: string;
}

export interface UpdatePlanoInput {
  template_id?: string;
  conteudo_gerado?: Record<string, unknown>;
  status?: PlanoStatus;
  arquivo_url?: string;
  arquivo_fillable_url?: string;
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
  estado?: string | null;
  campoCount: number;
  criadoEm: string;
  schema_campos?: TemplateFieldSchema[];
  metadata_padrao?: Record<string, string>;
  arquivo_url?: string;
  fillable_status?: TemplateFillableStatus;
  deletado?: boolean;
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

export type MensagemTipo = "contato" | "suporte";
export type MensagemStatus = "aberto" | "em_andamento" | "resolvido";

export interface MensagemRecord {
  id: string;
  tipo: MensagemTipo;
  user_id?: string;
  nome: string;
  email: string;
  assunto: string;
  mensagem: string;
  status: MensagemStatus;
  created_at: string;
  resposta?: string;
  respondido_em?: string;
}

export interface BalanceteRecord {
  id: string;
  tipo: "mensal" | "anual";
  periodo: string;           // "2026-05" ou "2026"
  mrr_brl: number;
  custo_ia_usd: number;
  custo_fixo_usd: number;
  custo_total_usd: number;
  resultado_brl: number;     // mrr_brl − (custo_total_usd × usd_brl)
  saldo_anterior_brl: number;
  saldo_final_brl: number;
  fechado_em: string;
  fechado_por: string;
  notas?: string;
  usuarios_por_plano: Record<string, number>;
  total_usuarios: number;
  planos_gerados: number;
  tokens_total: number;
}

export interface MercadoPagoAssinatura {
  id: string;
  user_id: string;
  mp_preapproval_id: string;
  plano: string;
  status: "authorized" | "paused" | "cancelled" | "pending";
  valor_brl: number;
  created_at: string;
  updated_at: string;
}

export interface CouponRecord {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  planos: string[];
  valid_from: string;
  valid_until: string;
  max_uses: number | null;
  uses: number;
  active: boolean;
  created_at: string;
  created_by: string;
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
