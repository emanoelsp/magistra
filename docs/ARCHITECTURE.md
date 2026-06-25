# Arquitetura — PlanoMagistra

> Documento vivo. Última revisão: junho 2026.

---

## 1. Visão Geral do Produto

SaaS B2C para professores da educação básica brasileira. O produto elimina o trabalho manual de preenchimento de planos de aula, reduzindo 70%+ do tempo através de três mecanismos:

1. **Extração de schema**: professor sobe o DOCX da escola → IA identifica cada campo e classifica como manual (professor preenche) ou `ia_sugerida` (Magis sugere).
2. **Editor split-view**: professor preenche campos manuais → Magis gera sugestões contextualizadas por campo (BNCC, SAEB, currículo territorial).
3. **Download DOCX**: valores injetados no arquivo original da escola via Docxtemplater → download do plano pronto.

---

## 2. Stack e Decisões Tecnológicas

| Camada | Tecnologia | Decisão |
|--------|-----------|---------|
| Framework | **Next.js 15 + App Router** | Server Components para busca de dados sem waterfall; API Routes para endpoints; `after()` para trabalho em background pós-resposta |
| Linguagem | **TypeScript estrito** | `any` proibido; tipos centralizados em `lib/types/firestore.ts` |
| Estilo | **Tailwind CSS** | Sem shadcn/ui — componentes escritos à mão para máximo controle visual |
| Auth | **Firebase Auth** | Email/senha + session cookie httpOnly — escolhido por integração nativa com Firestore |
| Banco | **Cloud Firestore** | NoSQL flexível; queries simples; `user_id` em todo documento para isolamento por tenant |
| IA primária | **Claude (Anthropic)** | `claude-sonnet-4-6`; usado para análise pedagógica de alta fidelidade |
| IA fallback | **Gemini → OpenAI → Groq** | Cadeia de fallback em `lib/ai/provider.ts`; Claude primário, demais em sequência |
| DOCX processing | **Docxtemplater + PizZip** | Substitui `{{key}}` no XML OOXML; PizZip para leitura/escrita do ZIP |
| Storage | **Vercel Blob** | Armazena `original.docx` e `fillable.docx` separados (Immutable Base Pattern) |
| Deploy | **Vercel** | Zero-config com Next.js; `after()` requer runtime Node |
| Testes | **Vitest** | Testes de regressão snapshot para o motor OOXML |

### Por que Claude como primário em vez de Gemini?

Gemini era o único provedor no início do projeto. Claude foi adicionado como primário na cadeia de IA por dois motivos:
- Raciocínio pedagógico mais fiel (menos alucinações de códigos BNCC)
- Controle de `TOON` (tom + extensão): Claude respeita melhor instruções de formato no system prompt

Gemini permanece como fallback de latência baixa e custo baixo para sugestões de campo.

---

## 3. Estrutura de Diretórios

```
/app
  /api
    /ia/campo/route.ts              → Sugestão IA por campo (editor split-view)
    /ia/sequencia/route.ts          → Geração de sequência didática
    /templates/upload-arquivo/      → Upload DOCX original + geração fillable inicial
    /templates/introspect/          → Extração de schema via IA (Gemini/Claude)
    /templates/[id]/arquivo/        → Serve fillable ou original do Vercel Blob
    /templates/[id]/schema/         → Pipeline completo de save (injeção + Blob + Firestore)
    /planos/[id]/download/          → Geração DOCX final + streaming download
    /perfil/tempo-economizado/      → Acumula minutos economizados (FieldValue.increment)
    /session/                       → Cria session cookie httpOnly
    /logout/                        → Remove session cookie
  /dashboard
    /page.tsx                       → Dashboard hero + estatísticas + badge tempo economizado
    /templates/page.tsx             → Listagem de templates (flat list)
    /templates/[id]/editar/page.tsx → Editor de campos do template
    /planos/novo/page.tsx           → PlanEditor split-view (fluxo principal)
    /historico/page.tsx             → Lista de planos + download
    /escolas/page.tsx               → Gestão de escolas e turmas
    /perfil/page.tsx                → Perfil + plano de assinatura
  /login/page.tsx                   → Autenticação
  /page.tsx                         → Landing page

/components
  /escolas
    /escolas-manager.tsx            → Client Component: CRUD escolas, cursos, turmas
  /layout
    /Sidebar.tsx                    → Navegação lateral responsiva
  /planos
    /plan-editor.tsx                → Editor split-view principal (campos + painel IA)
    /plan-generation-wizard.tsx     → Wizard de criação: metadados → editor → finalizar
  /templates
    /templates-list.tsx             → Lista de templates com ações
    /templates-uploader.tsx         → Upload + introspecção inline
    /template-field-editor.tsx      → Editor visual de campos no DOCX (1500+ linhas)

/lib
  /ai
    /provider.ts                    → Cadeia Claude → Gemini → OpenAI → Groq
  /auth
    /session.ts                     → getCurrentSession, requireCurrentUserProfile (server-only)
  /firebase
    /admin.ts                       → Admin SDK — getAdminDb() (server-only)
    /client.ts                      → Client SDK — firebaseDb
  /services
    /firestore
      /dashboard.server.ts          → getDashboardStats, getUserTemplateOptions
      /escolas.service.ts           → CRUD escolas/turmas (client-side)
      /templates.service.ts         → CRUD templates (client-side)
      /planos.service.ts            → CRUD planos (client-side)
    /limits.ts                      → Verifica cotas de plano antes de criar
  /storage
    /blob.ts                        → uploadFile, downloadFile (Vercel Blob)
  /types
    /firestore.ts                   → Todos os tipos: TemplateFieldSchema, Plano, UserProfile…
  /utils
    /docx-filler.ts                 → Motor OOXML: injectPlaceholders, fillDocx, normalizeDocxXml
    /docx-schema-mapper.ts          → StructuralPair[] → TemplateFieldSchema[]
    /docx-anchor-fix.ts             → Reposiciona imagens ancoradas no HTML renderizado
    /docx-coord.ts                  → Atribui data-xml-coord a células do DOM

/tests
  /helpers
    /make-docx.ts                   → makeDocx(xml) — cria DOCX mínimo válido para testes
    /format-xml.ts                  → formatXmlForSnapshot() — indenta OOXML para diffs legíveis
  /docx-filler.test.ts              → 5 fixtures × 2 tests = 10 testes de regressão snapshot
  /__snapshots__/                   → Golden state gerado em vitest run --update-snapshots

/.github/workflows/test.yml         → CI: npm test + npm run typecheck em pull_request + push
```

---

## 4. Coleções Firestore

### `magis_users/{uid}`
```typescript
{
  nome: string,
  email: string,
  escola_padrao?: string,              // nome da escola padrão do professor
  plano: "free" | "medio" | "avancado",
  tokens_usados_mes: number,
  tempo_economizado_min?: number,      // acumulado vitalício (FieldValue.increment)
  data_criacao: Timestamp,
}
```

### `magis_templates/{id}`
```typescript
{
  user_id: string,
  nome: string,
  escola_nome?: string,
  tipo_plano?: string,
  estado?: string,
  arquivo_url: string,                 // original.docx — NUNCA sobrescrito
  arquivo_fillable_url?: string,       // fillable.docx — regenerado a cada save
  fillable_status: "pronto" | "processando" | "erro",
  schema_campos: TemplateFieldSchema[],
  field_positions: Record<string, {    // coords persistidas após save
    cellText: string,
    ordinal: number,
    coord?: string,                    // "T1R2C3" — preferido sobre cellText
  }>,
  metadata_padrao?: Record<string, string>,
  data_criacao: Timestamp,
  data_atualizacao?: Timestamp,
}
```

### `TemplateFieldSchema` (tipo central)
```typescript
{
  key: string,                          // identificador único no template
  label: string,                        // texto exibido no editor e no DOCX
  type: "text" | "textarea" | "date" | "number" | "select",
  required: boolean,
  role: "manual" | "ia_sugerida",       // manual = professor; ia_sugerida = Magis
  group: "dados_turma" | "objetivos" | "competencias" | "habilidades"
       | "conteudos" | "avaliacao" | "outros",
  injection_pattern?: "adjacent_right" | "adjacent_below" | "inline_colon"
                    | "column_header" | "period_column",
  ai_confidence?: number,               // 0–1; confiança da IA na detecção
  placeholder?: string,
  helperText?: string,
  aiInstructions?: string,
  defaultValue?: string,
}
```

### `magis_planos/{id}`
```typescript
{
  user_id: string,
  template_id: string,
  status: "rascunho" | "gerado",
  conteudo_gerado: Record<string, string>,  // { fieldKey: valor preenchido }
  metadata: {                               // dados da turma
    escola?: string,
    turma?: string,
    ano_letivo?: string,
    disciplina?: string,
    etapa?: string,
  },
  data_criacao: Timestamp,
  data_atualizacao?: Timestamp,
}
```

### `magis_escolas/{id}`
```typescript
{
  user_id: string,
  nome: string,
  cursos?: Array<{
    tipo: string,       // "EF1" | "EF2" | "EM" | "EJA" | "Técnico" | "Superior"
    label: string,
  }>,
  data_criacao: Timestamp,
}
```

### `magis_turmas/{id}`
```typescript
{
  user_id: string,
  escola_id: string,
  nome: string,          // "8º Ano A"
  ano: string,
  tipo_curso?: string,
  data_criacao: Timestamp,
}
```

---

## 5. Fluxos de Dados

### Fluxo 1 — Upload de Template + Extração de Schema

```
CLIENTE                       SERVIDOR                         EXTERNO
──────                        ────────                         ───────

1. FormData (file, id)  ────► POST /api/templates/upload-arquivo
                                 ├─ Buffer.from(arrayBuffer)
                                 ├─ uploadFile(original.docx)  ──────► Vercel Blob
                                 ├─ scanPlaceholders(buffer)
                                 │   SE {{tokens}} já presentes:
                                 │     detectedSchema ← tokens
                                 │     fillable = original (mesmo arquivo)
                                 │   SENÃO:
                                 │     injectPlaceholders(buffer, schemaExistente)
                                 │     uploadFile(fillable.docx) ────► Vercel Blob
                                 └─ Firestore.update({ fillable_status, arquivo_fillable_url })

2. FormData (file, id)  ────► POST /api/templates/introspect
                                 ├─ extractDocxText → texto plano
                                 ├─ scanDocxStructure → StructuralPair[]
                                 │   normalizeDocxXml:
                                 │     • stripChangeTracking (proofErr, bookmarks, ins/del)
                                 │     • mergeAdjacentRuns (une runs fragmentados pelo Word)
                                 │   parseRows → detecta padrões:
                                 │     • adjacent_right  (Label | Valor ao lado)
                                 │     • adjacent_below  (Label / Valor abaixo)
                                 │     • inline_colon    (Label: valor na mesma célula)
                                 │     • column_header   (cabeçalho de coluna)
                                 │     • period_column   (trimestre/bimestre)
                                 ├─ callAIWithFallbacks(prompt + structural pairs)
                                 │   responseMimeType: "application/json"
                                 │   → { raciocinio, campos: TemplateFieldSchema[] }
                                 └─ Firestore.update({ schema_campos, fillable_status })

3. Usuário confirma/edita schema (client-side sidebar)

4. PATCH /api/templates/{id}/schema  ← schema confirmado
```

### Fluxo 2 — Editor de Campos do Template (save)

O pipeline garante que o DOCX original nunca é modificado. A cada save:

```
PATCH /api/templates/{id}/schema
   │
   ├─ 1. downloadFile(arquivo_url)          // sempre o original limpo
   ├─ 2. normalizeDocxXml(xml)              // strip change tracking + merge runs
   ├─ 3. stripNonSchemaTokens(buffer, keys) // remove {{tokens}} de campos deletados
   ├─ 4. merge field_positions              // Firestore histórico + request atual
   │
   ├─ 5a. cell_edits → injectAtCoord()      // coord "T1R2C3" → navega tabela XML
   │       safeAppendToken(tc, "{{key}}")   //   vazia: escreve no 1º <w:t>
   │                                        //   com texto: appenda novo <w:r>
   ├─ 5b. allPositions → injectAtCoord()    // campos já posicionados (exceto 5a)
   │
   ├─ 6. injectPlaceholders()               // campos SEM posição: label-matching
   │       matchField() → normText + aliases
   │       → injection_pattern: inline_colon | adjacent_right | adjacent_below…
   │
   ├─ 7. reportInjections()                 // detecta campos sem placeholder
   ├─ 8. appendOrphanField()               // garante que docxtemplater sempre acha o token
   │
   ├─ 9. uploadFile(fillable.docx)          // → Vercel Blob (sobrescreve fillable)
   ├─ 10. extractFieldCoords(buffer)        // varre XML final, extrai coords
   └─ 11. Firestore.update({ schema_campos, arquivo_fillable_url,
                              field_positions (com coords), fillable_status: "pronto" })
```

**Invariante — Immutable Base Pattern**: `arquivo_url` (original) nunca é tocado. Isso elimina:
- **Ghost tokens**: campos deletados não sobrevivem entre saves
- **Position drift**: label-matching não re-injeta na célula errada
- **State accumulation**: erros não se acumulam iteração a iteração

### Fluxo 3 — Editor Split-View (criação de plano)

```
GET /dashboard/planos/novo?template=[id]
   └─ Server Component: Admin SDK → template.schema_campos
   └─ Renderiza PlanGenerationWizard com templateRecord como prop

PlanGenerationWizard (Client Component)
   ├─ Passo 1: metadados (escola, turma, ano, disciplina, etapa)
   └─ Passo 2: PlanEditor (split-view)

PlanEditor
   ├─ Estado: values (Record<string,string>), activeFieldKey, suggestions
   ├─ onProgressChange(filled, total) → contador (X/Y) no botão "Revisar"
   │
   ├─ WizardMode entry banner (quando nenhum campo IA preenchido):
   │   "Gerar tudo" → generateAllIaFields() → POST /api/ia/campo por campo
   │
   ├─ Campo focado → painel direito mostra sugestões via POST /api/ia/campo
   │   { templateId, fieldKey, fieldLabel, fieldGroup, metadata }
   │   → { sugestoes: [{ id, label, descricao?, fonte? }] }
   │
   ├─ "Inserir" → adiciona texto ao campo ativo
   ├─ "Salvar rascunho" → planosService.createPlano/updatePlano { status: "rascunho" }
   └─ "Finalizar" → updatePlano { status: "gerado" }
                  → calcula tempo economizado (calcTempoEconomizado)
                  → POST /api/perfil/tempo-economizado { minutos }  // fire-and-forget
                  → window.open(/api/planos/[id]/download)
```

**Fórmula de tempo economizado**:
```typescript
const totalWords = iaSchema.reduce((sum, f) => sum + countWords(values[f.key]), 0);
const sessionMinutes = Math.max(1, Math.round((Date.now() - sessionStart) / 60_000));
const estimatedMinutes = Math.round(totalWords / 40 + 15);  // 40 WPM + 15min pesquisa BNCC
return Math.max(5, estimatedMinutes - sessionMinutes);       // floor de 5 min
```

### Fluxo 4 — Download DOCX

```
GET /api/planos/[id]/download
   ├─ requireCurrentUserProfile() → session cookie httpOnly
   ├─ Admin SDK: busca plano (user_id == uid)
   ├─ Admin SDK: busca template → arquivo_fillable_url
   ├─ downloadFile(fillable_url) → buffer DOCX com {{tokens}}
   ├─ fillDocx(buffer, schema_campos, conteudo_gerado)
   │   Docxtemplater({ linebreaks: true, nullGetter: () => "" })
   │   → substitui todos os {{key}} pelos valores do plano
   └─ Response: Content-Disposition: attachment; filename="plano.docx"
               Content-Type: application/vnd.openxmlformats-officedocument…
```

---

## 6. Cadeia de Provedores de IA

```typescript
// lib/ai/provider.ts
Cadeia: Claude (Anthropic) → Gemini → OpenAI → Groq

callAIWithFallbacks(prompt, system, options):
  for provider of [claude, gemini, openai, groq]:
    try:
      return await provider.generate(prompt, system)
    catch (503 | 429 | RECITATION):
      continue  // retry até 3x por provider, depois próximo
  throw "Todos os provedores falharam"
```

**Regras de uso por contexto**:
- Introspecção de schema (Fluxo 1): Claude primário (maior fidelidade pedagógica)
- Sugestões por campo (Fluxo 3): Gemini como primeiro fallback (latência menor)
- `TOON` (instruções de tom): ignorado no Claude — sistema instrui via system prompt

---

## 7. Motor OOXML — `lib/utils/docx-filler.ts`

Funções principais:

| Função | Responsabilidade |
|--------|-----------------|
| `scanDocxStructure(buffer)` | Analisa tabelas do XML → retorna `StructuralPair[]` com `injection_pattern` |
| `normalizeDocxXml(xml)` | Strip change tracking + merge runs fragmentados |
| `injectPlaceholders(buffer, schema)` | Label-matching heurístico → insere `{{key}}` nas células certas |
| `injectAtCoord(xml, coord, key)` | Injeção determinística por coordenada "T1R2C3" |
| `fillDocx(buffer, schema, values)` | Docxtemplater: substitui `{{key}}` pelos valores finais |
| `scanPlaceholders(buffer)` | Detecta `{{tokens}}` já presentes no DOCX |
| `stripNonSchemaTokens(buffer, keys)` | Remove tokens de campos deletados |
| `appendOrphanField(buffer, field)` | Garante que token existe mesmo sem posição detectada |
| `extractFieldCoords(buffer)` | Varre XML final, extrai coordenadas de cada `{{key}}` |
| `reportInjections(buffer, schema)` | Auditoria: quais campos não foram injetados |

**Coordenadas OOXML** (`T{table}R{row}C{col}`, base 1): persistidas no Firestore em `field_positions`. A coordenada tem precedência sobre o label-matching — uma vez que um campo foi posicionado manualmente, o save seguinte usa coord, não texto.

---

## 8. Testes de Regressão — Vitest

```
tests/
  docx-filler.test.ts          → 10 testes snapshot (5 fixtures × 2 cenários)
  helpers/
    make-docx.ts               → makeDocx(xml) — DOCX mínimo válido via PizZip
    format-xml.ts              → formatXmlForSnapshot() — indenta OOXML para diffs legíveis
  __snapshots__/               → Golden state: aprovado via npm run test:update
```

**Estratégia dual**:
- **Strategy A** (Fixtures A–D): DOCX pré-anotado com `{{key}}`. Testa `fillDocx` em isolamento.
- **Strategy B** (Fixture E): DOCX raw sem tokens. Testa pipeline completo `injectPlaceholders → fillDocx`.

**Fixtures**:
| Fixture | Cenário | Cobertura |
|---------|---------|-----------|
| A — dados-turma | Tabela 4 colunas, campos manuais | Layout mais comum de escola |
| B — campos-ia | Tabela 1 coluna, campos IA, multiline | Sugestões com quebra de linha |
| C — plano-completo | Múltiplas tabelas, todos os grupos | Plano completo de ponta a ponta |
| D — html-tiptap | Valores com `&` e `<` (XML reserved) | Escape de caracteres perigosos |
| E — injection-pipeline | DOCX raw, `adjacent_right`, Strategy B | Regressão no label-detection engine |

**Torture overlay** (aplicado em todos os fixtures):
```typescript
keys[0] → multiline ("Linha 1\nLinha 2\n\nLinha 4")
keys[1] → empty string (testa nullGetter)
keys[2] → "A".repeat(400) (string longa)
keys[3] → "Texto com {{chaves_falsas}} no meio" (não deve ativar parser)
keys[4] → "& <tags>" (escape XML)
```

**CI**: `.github/workflows/test.yml` executa `npm test + npm run typecheck` em todo PR e push na main.

---

## 9. Sistema de Limites de Plano

```typescript
// lib/services/limits.ts
const PLAN_LIMITS = {
  free:     { maxTemplates: 0, maxPlanosPerMonth: 0 },
  medio:    { maxTemplates: 2, maxPlanosPerMonth: 2 },
  avancado: { maxTemplates: 10, maxPlanosPerMonth: 20 },
};
```

Todo usuário começa com `plano: "medio"` (mock MVP — sem integração de pagamento). A verificação é feita no servidor antes de criar template ou plano. Pagamento não é implementado no MVP.

---

## 10. Segurança

- **Session cookie** `httpOnly; SameSite=Lax; Secure` — validado em todo Server Component de dashboard via `requireCurrentUserProfile()` (`lib/auth/session.ts`)
- **Admin SDK** nunca importado em Client Components — `"server-only"` obrigatório em `lib/firebase/admin.ts` e `lib/auth/session.ts`
- **Queries Firestore** sempre filtradas por `user_id == uid` — sem acesso cruzado entre usuários
- **Variáveis sensíveis** apenas em `.env.local` (nunca commitadas)
- **Validação de input** nas API Routes: tipos verificados antes de qualquer operação (ex.: `typeof minutos !== "number"`)

---

## 11. Métricas de Uso — Tempo Economizado

**Acumulação**: `POST /api/perfil/tempo-economizado` usa `FieldValue.increment(Math.round(minutos))` — operação atômica no Firestore, sem race condition mesmo com múltiplas abas abertas.

**Exibição**:
- Badge no Dashboard Hero: "X min economizados com o Magistra"
- Balão WhatsApp no modal de finalização: "⏱ Você economizou ~X min de trabalho!"

**Fórmula** (ver Fluxo 3 para código completo): baseia-se em contagem de palavras geradas pela IA, tempo de digitação estimado a 40 WPM, 15 min de pesquisa BNCC baseline, menos o tempo real da sessão. Floor de 5 min garante métrica sempre positiva.

---

## 12. Gestão de Escolas e Turmas

Hierarquia: **Escola → Curso (modalidade) → Turma**

- Escola sem cursos: turmas são planas (sem agrupamento)
- Escola com cursos: turmas pertencem a uma modalidade (EF1, EF2, EM, EJA, Técnico, Superior)
- Suporte a `desagrupar`: move turma de um curso para o estado flat

Componente `EscolasManager` (~1600 linhas): gerencia o CRUD completo com 8 modais:
`EscolaModal`, `DeleteEscolaModal`, `AddCursoModal`, `EditCursoModal`, `DeleteCursoModal`, `AddTurmaModal`, `EditTurmaModal`, `DeleteTurmaModal`

---

## 13. Padrões de UI

| Elemento | Classes Tailwind |
|----------|-----------------|
| Card container | `rounded-3xl border border-slate-200 bg-white p-6 shadow-sm` |
| Card item (lista) | `rounded-2xl border border-slate-200 bg-slate-50 p-4` |
| Input | `rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950` |
| Botão primário | `rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white` |
| Botão IA / Magis | `rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white` |
| Botão sucesso | `rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white` |
| Botão dashed (add) | `rounded-xl border border-dashed border-violet-300 px-3 py-1.5 text-xs text-violet-600` |
| Balão Magis | `rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm` |

**Padrão de lista flat**: templates, planos e escolas seguem o mesmo padrão visual — cada item como card `bg-slate-50 rounded-2xl` com espaçamento `space-y-3`, precedido de header de seção com contador.

---

## 14. Comandos de Desenvolvimento

```bash
npm run dev              # servidor de desenvolvimento (porta 3000)
npm run build            # build de produção
npm run typecheck        # TypeScript sem emitir
npm run lint             # ESLint
npm test                 # Vitest snapshot tests
npm run test:watch       # Vitest em modo watch
npm run test:update      # Atualiza golden state (aprovação explícita de mudanças)
```
