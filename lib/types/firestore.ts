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
  /** When true, the PlanEditor shows an "Importar do professor de área" button for this field. */
  importavel_de_regente?: boolean;
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
  /** Acumulado vitalício — total de minutos economizados com o Magistra. */
  tempo_economizado_min?: number;
  /** Contador mensal de chamadas à /api/ia/campo — reset quando ia_campo_mes muda */
  ia_campo_calls_mes?: number;
  /** Mês de referência do contador — formato "YYYY-MM" */
  ia_campo_mes?: string;
  /** Denormalized flag — true when any turma has tipo_professor === "segundo_professor" */
  is_segundo_professor?: boolean;
}

export type TemplateFillableStatus = "processando" | "pronto" | "erro";

export type TemplateType = "regente" | "plano_educacional_individualizado";

// ── Plano do Professor Regente (extraído de PDF/DOCX) ────────────────────────

export interface PlanoRegenteConteudo {
  objetivos?: string;
  competencias?: string;
  habilidades?: string;
  conteudos?: string;
  avaliacao?: string;
  metodologia?: string;
  outros?: string;
}

export interface PlanoRegenteRecord {
  id: string;
  user_id: string;
  /** Componente curricular detectado pela IA */
  disciplina: string;
  /** Nome do professor regente (se detectado no arquivo) */
  professor?: string;
  arquivo_nome: string;
  conteudo: PlanoRegenteConteudo;
  criado_em: string;
  /** IDs dos planos PEI que já importaram deste plano */
  usado_por_pei?: string[];
}

/**
 * Bloco de disciplina extraído de um plano de ensino do regente — uso em memória,
 * sem persistência no Firestore. Um por arquivo enviado no fluxo PEI.
 * Os valores de "turma" vêm do regente; os de "estudante" são preenchidos
 * pelo segundo professor (com sugestão da Magis) no editor do PEI.
 */
export interface DisciplinaBlock {
  /** Componente curricular (ex: "Língua Portuguesa") */
  disciplina: string;
  /** Nome do professor regente (pode estar vazio) */
  professor: string;
  /** Nome do arquivo de origem */
  arquivo_nome: string;
  /** Habilidades da turma extraídas do plano do regente */
  habilidades_turma: string;
  /** Objeto de conhecimento da turma */
  objeto_conhecimento_turma: string;
  /** Competências da turma */
  competencias_turma: string;
  /** Objetivos do regente */
  objetivos_turma: string;
  /** Avaliação proposta pelo regente */
  avaliacao_turma: string;
  /** Metodologia do regente */
  metodologia_turma: string;
  // Campos do estudante — preenchidos pelo 2.º professor no editor
  habilidades_estudante: string;
  objeto_conhecimento_estudante: string;
  avaliacao_estudante: string;
}

export interface TemplateRecord {
  id: string;
  user_id: string;
  nome: string;
  escola_nome?: string | null;
  tipo_plano?: string | null;
  estado?: string | null;
  /** Drives wizard bifurcation: regente = standard flow, plano_educacional_individualizado = second-teacher flow */
  template_type?: TemplateType;
  /** Set by introspection when the document signals PEI traits but confidence is below threshold */
  tipo_incerto?: boolean;
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
  template_type?: TemplateType;
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
  turma_id?: string;
  escola_id?: string;
  /** Linked special-needs student for Plano Educacional Individualizado flows */
  estudante_id?: string;
  estudante_nome?: string;
  /** Extracted text from regente teacher's plans — used as AI context for PEI field suggestions */
  planos_regentes_contexto?: string;
  /** Pre-generated PDF stored in Vercel Blob — served via 302 redirect on download. */
  pdf_url?: string;
  pdf_status?: "gerando" | "pronto" | "erro";
  pdf_error?: string;
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
  turma_id?: string;
  escola_id?: string;
  estudante_id?: string;
  estudante_nome?: string;
  planos_regentes_contexto?: string;
}

export interface UpdatePlanoInput {
  template_id?: string;
  conteudo_gerado?: Record<string, unknown>;
  status?: PlanoStatus;
  arquivo_url?: string;
  arquivo_fillable_url?: string;
  estudante_id?: string;
  estudante_nome?: string;
  planos_regentes_contexto?: string;
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
  template_type?: TemplateType;
  /** True when introspection detected PEI signals but confidence is below threshold — UI should ask professor to confirm. */
  tipo_incerto?: boolean;
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
  namespace?: string; // namespace RAG de origem: "bncc" | "saeb" | "curriculo_estadual" | "cnct" | "curriculo_digital" | "unknown"
  aviso?: string;    // presente quando adaptado de outro componente curricular — ex: "Não encontrei habilidade exata de Matemática. EF06CI01 é de Ciências, mas se alinha porque ambas desenvolvem raciocínio proporcional."
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

export type CursoTipo = "fundamental" | "medio" | "medio_tecnico" | "superior";

export interface CursoEntry {
  tipo: CursoTipo;
  nome?: string; // nome do curso — obrigatório para medio_tecnico e superior
}

export type TipoProfessor = "segundo_professor" | "professor_area";

export interface EscolaRecord {
  id: string;
  user_id: string;
  nome: string;
  cursos?: CursoEntry[];
  criado_em: string;
}

export interface TurmaRecord {
  id: string;
  user_id: string;
  escola_id: string;
  escola_nome: string;
  nome: string;
  ano_letivo: number;
  tipo_professor?: TipoProfessor;
  disciplina?: string;
  tipo_curso?: CursoTipo;
  curso_nome?: string;
  grupo_id?: string | null;
  tem_aluno_especial?: boolean;
  criado_em: string;
}

// ── Estudante (Segundo Professor / Plano Educacional Individualizado) ─────────

/** Support intensity level per PAEE classification */
export type NivelSuporte = "baixo" | "medio" | "alto";

/**
 * Represents a special-needs student whose PEI is managed by a segundo professor.
 * Stored in the `magis_estudantes` Firestore collection.
 */
export interface EstudanteRecord {
  id: string;
  user_id: string;              // UID do segundo professor responsável
  nome: string;
  data_nascimento?: string;     // ISO date string "YYYY-MM-DD"
  escola_id?: string;
  escola_nome?: string;
  turma_id?: string;
  turma_nome?: string;
  /** CID-10 code(s) — e.g. "F84.0", "F70" */
  cid?: string;
  /** Free-text clinical/pedagogical diagnosis */
  diagnostico?: string;
  /** Educational needs description (NEE) */
  necessidades?: string;
  nivel_suporte?: NivelSuporte;
  /** Predictive skills targeted in this student's PEI */
  habilidades_preditoras?: string[];
  observacoes?: string;
  criado_em: string;
  atualizado_em?: string;
}

export interface CreateEstudanteInput {
  user_id: string;
  nome: string;
  data_nascimento?: string;
  escola_id?: string;
  escola_nome?: string;
  turma_id?: string;
  turma_nome?: string;
  cid?: string;
  diagnostico?: string;
  necessidades?: string;
  nivel_suporte?: NivelSuporte;
  habilidades_preditoras?: string[];
  observacoes?: string;
}

export interface UpdateEstudanteInput {
  nome?: string;
  data_nascimento?: string;
  escola_id?: string;
  escola_nome?: string;
  turma_id?: string;
  turma_nome?: string;
  cid?: string;
  diagnostico?: string;
  necessidades?: string;
  nivel_suporte?: NivelSuporte;
  habilidades_preditoras?: string[];
  observacoes?: string;
}
