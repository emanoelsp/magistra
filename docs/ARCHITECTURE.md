# Arquitetura — PlanoMagistra

## Stack

| Camada | Tecnologia | Motivo |
|--------|-----------|--------|
| Framework | Next.js 15 + TypeScript | App Router, Server Components, API Routes |
| Estilo | Tailwind CSS | Utility-first, sem dependência de componentes UI externos |
| Auth | Firebase Auth | Email/senha, session cookie seguro |
| Banco | Cloud Firestore | NoSQL flexível, queries simples |
| IA | Google Gemini (gemini-2.0-flash) | Extração de schema + sugestões pedagógicas |
| Deploy | Vercel | Zero-config com Next.js |

## Estrutura de diretórios

```
/app
  /api
    /gerar-plano        → Sugestões IA em lote (wizard legado)
    /ia/campo           → Sugestão IA por campo (editor split-view)
    /templates/introspect → Extração de schema do PDF/DOCX
    /planos/[id]/download → Geração e download do PDF
    /session            → Criação do session cookie
    /logout             → Remoção do session cookie
  /dashboard
    /page.tsx           → Dashboard com estatísticas
    /templates          → Listagem + upload de templates
    /templates/[id]/editar → Editor de campos do template
    /planos/novo        → Editor Word-like (principal fluxo de criação)
    /gerar              → Wizard legado (mantido)
    /historico          → Lista de planos + download
    /perfil             → Perfil e assinatura
  /login               → Autenticação
  /page.tsx            → Landing page

/components
  /dashboard
    /stat-card.tsx      → Card de estatística
  /layout
    /Sidebar.tsx        → Navegação lateral
  /planos
    /plan-editor.tsx    → Editor split-view (novo, principal)
    /plan-generation-wizard.tsx → Wizard legado
  /templates
    /templates-list.tsx → Lista com ações por template
    /templates-uploader.tsx → Upload e introspecção
    /template-field-editor.tsx → Edição in-app de campos

/lib
  /auth/session.ts      → getCurrentSession, requireCurrentUserProfile
  /firebase/admin.ts    → Admin SDK (server-only)
  /firebase/client.ts   → Client SDK
  /services/firestore
    /dashboard.server.ts → getDashboardStats, getUserTemplateOptions
    /templates.service.ts → CRUD de templates (client-side)
    /planos.service.ts   → CRUD de planos (client-side)
  /services/limits.ts   → Verificação de limites de plano
  /types/firestore.ts   → Tipos compartilhados
```

## Coleções Firestore

### `users/{uid}`
```json
{
  "nome": "Maria Silva",
  "email": "maria@escola.com",
  "escola_padrao": "Escola Municipal João XXIII",
  "plano": "medio",
  "tokens_usados_mes": 1200
}
```

### `templates/{id}`
```json
{
  "user_id": "uid",
  "nome": "Plano de Aula - EF",
  "escola_nome": "Escola Municipal João XXIII",
  "tipo_plano": "plano_de_aula",
  "schema_campos": [
    {
      "key": "turma",
      "label": "Turma",
      "type": "text",
      "required": true,
      "role": "manual",
      "group": "dados_turma"
    },
    {
      "key": "habilidades_bncc",
      "label": "Habilidades BNCC",
      "type": "textarea",
      "required": true,
      "role": "ia_sugerida",
      "group": "habilidades"
    }
  ],
  "data_criacao": "Timestamp"
}
```

### `planos/{id}`
```json
{
  "user_id": "uid",
  "template_id": "tid",
  "status": "gerado",
  "conteudo_gerado": {
    "turma": "5º ano B",
    "escola": "Escola Municipal João XXIII",
    "habilidades_bncc": "EF05LP01 - Reconhecer...",
    "objetivos_gerais": "Desenvolver a leitura..."
  },
  "data_geracao": "Timestamp"
}
```

## Fluxo de dados — Editor split-view

```
1. GET /dashboard/planos/novo?template=[id]
   └── Server: busca template no Admin SDK
   └── Renderiza PlanEditor com template.schema_campos

2. Usuário preenche campo manual (turma, ano, disciplina)
   └── Client: atualiza estado local values[fieldKey]
   └── Se metadata completa (escola+turma+ano+disciplina):
       └── POST /api/ia/campo { fieldKey, metadata } → sugestões

3. Usuário foca campo ia_sugerida
   └── Painel direito atualiza para mostrar sugestões do campo ativo
   └── Se não há sugestões: botão "Gerar sugestões" disponível

4. Usuário clica "Inserir" numa sugestão
   └── Client: values[activeField] += '\n' + suggestion.label

5. Usuário clica "Salvar rascunho"
   └── Client: planosService.createPlano/updatePlano { status: 'rascunho', conteudo_gerado: values }

6. Usuário clica "Finalizar e baixar PDF"
   └── Client: planosService.updatePlano { status: 'gerado' }
   └── Client: window.open(/api/planos/[id]/download)
```

## Fluxo de IA — Sugestão por campo

```
POST /api/ia/campo
Body: { templateId, fieldKey, fieldLabel, fieldGroup, metadata }

1. Busca template no Firestore Admin para contexto
2. Monta prompt:
   - Contexto: escola, turma, ano, disciplina, etapa
   - Campo: key, label, group
   - Instrução: gere 3–5 sugestões relevantes no formato { id, label, descricao?, fonte? }
3. Chama Gemini com responseMimeType: "application/json"
4. Parseia e retorna array de sugestões
```

## Limites de plano (mock MVP)

```typescript
const PLAN_LIMITS = {
  free:     { maxTemplates: 0, maxPlanosPerMonth: 0 },
  medio:    { maxTemplates: 2, maxPlanosPerMonth: 2 },
  avancado: { maxTemplates: 10, maxPlanosPerMonth: 20 },
};
```

Verificação: `lib/services/limits.ts` — consulta Firestore Admin para contar templates e planos do mês atual.

## Regras de segurança

- Nunca expor Firebase Admin no cliente
- Session cookie httpOnly validado em todo Server Component de dashboard
- Queries Firestore sempre filtradas por `user_id == uid`
- Variáveis sensíveis apenas em `.env.local` (nunca commitadas)

---

## Fluxo 1 — Upload do template + extração de placeholders

```
CLIENTE                          SERVIDOR (Next.js API)              SERVIÇOS EXTERNOS
─────────                        ──────────────────────              ─────────────────

  ├─ 1. Upload do arquivo ────────► POST /api/templates/upload-arquivo
  │    (FormData: file + id)              │
  │                                       ├─ Buffer.from(file.arrayBuffer())
  │                                       ├─ uploadFile(original.docx) ─────────────► Vercel Blob
  │                                       │   → salva em templates/{id}/original.docx
  │                                       │
  │                                       ├─ scanPlaceholders(buffer)
  │                                       │   (percorre word/document.xml buscando {{keys}})
  │                                       │
  │                                       ├─ SE já tem {{tokens}} (arquivo pré-anotado):
  │                                       │   detectedSchema ← tokens → keyToField()
  │                                       │   fillableUrl = originalUrl (é o próprio)
  │                                       │
  │                                       └─ SE não tem tokens:
  │                                           injectPlaceholders(buffer, schemaExistente)
  │                                           → gera fillable com placeholders
  │                                           uploadFile(fillable.docx) ──────────────► Vercel Blob
  │
  ├─ 2. Extração com IA ──────────► POST /api/templates/introspect
  │    (FormData: file + id)              │
  │                                       ├─ extractDocxText(buffer)
  │                                       │   (PizZip → word/document.xml → strip tags → linhas)
  │                                       │
  │                                       ├─ scanDocxStructure(buffer)
  │                                       │   → normalizeDocxXml (strip proofErr/bookmarks,
  │                                       │      merge runs fragmentados)
  │                                       │   → parseRows → detecção de padrões:
  │                                       │     • adjacent_right  (label | valor ao lado)
  │                                       │     • adjacent_below  (label / valor abaixo)
  │                                       │     • inline_colon    (Label: valor mesma célula)
  │                                       │     • column_header   (cabeçalho de coluna)
  │                                       │     • period_column   (trimestre/bimestre)
  │                                       │   → retorna StructuralPair[]
  │                                       │
  │                                       ├─ callAIWithFallbacks(Gemini)
  │                                       │   prompt: texto + structural pairs
  │                                       │   system: 18 regras de extração (BNCC, labels
  │                                       │            exatos, títulos vs campos, padrões…)
  │                                       │   responseMimeType: "application/json"
  │                                       │   → retorna { raciocinio, campos: TemplateFieldSchema[] }
  │                                       │
  │                                       └─ Firestore.update({ schema_campos, fillable_status })
  │
  ├─ 3. Usuário confirma/edita schema     (no cliente — sidebar de campos)
  │
  └─ 4. Salva schema confirmado ──► PATCH /api/templates/{id}/schema
                                          └─ [ver Fluxo 2]
```

### Arquivos — Fluxo 1

| Arquivo | Papel |
|---|---|
| `app/api/templates/upload-arquivo/route.ts` | Upload original + geração inicial do fillable |
| `app/api/templates/introspect/route.ts` | Extração IA (Gemini) + structural pairs |
| `lib/utils/docx-filler.ts` → `scanPlaceholders` | Detecta `{{tokens}}` já existentes no XML |
| `lib/utils/docx-filler.ts` → `scanDocxStructure` | Analisa estrutura de tabelas → injection_pattern |
| `lib/utils/docx-schema-mapper.ts` | Converte StructuralPair[] → TemplateFieldSchema[] |
| `lib/storage/blob.ts` → `uploadFile` / `downloadFile` | Vercel Blob (objeto privado) |
| Firestore `magis_templates/{id}` | Persiste schema, urls, field_positions, coords |

---

## Fluxo 2 — Editor: adicionar/remover placeholders, salvar, mostrar atualizado

```
CLIENTE (template-field-editor.tsx)          SERVIDOR
────────────────────────────────             ────────

Server Page /dashboard/templates/{id}/editar
  └─ getAdminDb().collection("magis_templates").doc(id)
  └─ passa template (schema + urls) como prop para TemplateFieldEditor

TemplateFieldEditor (Client Component)
  │
  ├─ RENDER INICIAL DO DOCUMENTO
  │   DocxInteractive.fetchBuffer()
  │     GET /api/templates/{id}/arquivo?fresh=1&v=0
  │       SE arquivo_fillable_url existe → serve fillable direto do Blob
  │       SENÃO → injectPlaceholders(original, schema) on-the-fly
  │     ↓
  │   docx-preview.renderAsync(buffer, containerDiv, options)
  │     → HTML com <section class="docx"> (página A4)
  │   fixDocxAnchorImages() → reposiciona logos/imagens ancoradas
  │   assignDocxCellCoords() → atribui data-xml-coord="T1R2C3" a cada <td>
  │   colorChips() → colore {{key}} como chips visuais no DOM
  │
  ├─ AÇÕES DO USUÁRIO
  │
  │   A. EDITAR CÉLULAS (contenteditable)
  │      Usuário digita `{{professor}}` numa célula
  │      → tokenization loop detecta {{key}} visualmente
  │
  │   B. ADICIONAR CAMPO (botão "+" no sidebar)
  │      newField() → adiciona TemplateFieldSchema local
  │
  │   C. POSICIONAR COM CLIQUE (modo placement)
  │      handlePlace(key, coord, cellText, ordinal)
  │      → registra fieldPositions[key] = { cellText, ordinal, coord }
  │
  │   D. REMOVER CHIP (apagar no contenteditable)
  │      initialDocKeysRef detecta key que sumiu → removedKeys[]
  │
  │   E. REMOVER CAMPO (botão trash no sidebar)
  │      deletedKeys → allPositions[key] deletado do Firestore
  │
  ├─ SALVAR EDIÇÕES ──────────────────────────► PATCH /api/templates/{id}/schema
  │   handleSaveEdits()                              │
  │   coleta:                                        │
  │   • schema_campos (array atualizado)             │
  │   • cell_edits: [{                               │
  │       cellText: "Professor(a):",                 │
  │       ordinal: 0,                                │
  │       newContent: "{{professor}}",  ← só token  │
  │       coord: "T1R2C3"              ← preferido  │
  │     }]                                          │
  │   • field_positions (para novos campos)          │
  │                                                  │
  │                                    ┌─────────────┴──────────────────────────┐
  │                                    │  PIPELINE DE INJEÇÃO (Immutable Base)  │
  │                                    │                                         │
  │                                    │  1. downloadFile(arquivo_url)           │
  │                                    │     SEMPRE o original limpo             │
  │                                    │                                         │
  │                                    │  2. normalizeDocxXml(xml)               │
  │                                    │     • stripChangeTracking               │
  │                                    │       (proofErr, bookmarks, ins/del)    │
  │                                    │     • mergeAdjacentRuns                 │
  │                                    │       (une runs fragmentados por Word)  │
  │                                    │                                         │
  │                                    │  3. stripNonSchemaTokens(buffer, keys)  │
  │                                    │     Remove {{tokens}} de campos         │
  │                                    │     deletados (pass 1: string match;    │
  │                                    │     pass 2: defragmentação por parag.)  │
  │                                    │                                         │
  │                                    │  4. merge field_positions               │
  │                                    │     (Firestore histórico + request)     │
  │                                    │     deletedKeys → delete posição        │
  │                                    │                                         │
  │                                    │  5a. cell_edits → injectAtCoord()       │
  │                                    │      coord "T1R2C3" → navega tabela     │
  │                                    │      → safeAppendToken(tcXml, "{{k}}") │
  │                                    │        SE vazia: escreve no 1º <w:t>   │
  │                                    │        SE tem texto: appenda novo <w:r> │
  │                                    │                                         │
  │                                    │  5b. allPositions → injectAtCoord()     │
  │                                    │      Para campos já posicionados        │
  │                                    │      (exceto os do 5a)                  │
  │                                    │                                         │
  │                                    │  6. injectPlaceholders()                │
  │                                    │     Campos sem posição explícita →      │
  │                                    │     label-matching por heurísticas:     │
  │                                    │     matchField() → normText + aliases   │
  │                                    │     → pattern: inline_colon,            │
  │                                    │        adjacent_right, adjacent_below…  │
  │                                    │                                         │
  │                                    │  7. reportInjections()                  │
  │                                    │     Detecta campos sem placeholder      │
  │                                    │                                         │
  │                                    │  8. appendOrphanField()                 │
  │                                    │     Campos ainda não posicionados →     │
  │                                    │     append linha "Label: {{key}}"       │
  │                                    │     (garante que docxtemplater          │
  │                                    │      sempre encontra o token)           │
  │                                    │                                         │
  │                                    │  9. uploadFile(fillable.docx)           │
  │                                    │     → Vercel Blob                       │
  │                                    │     arquivo_fillable_url atualizada     │
  │                                    │                                         │
  │                                    │  10. extractFieldCoords(buffer)         │
  │                                    │      Varre XML final, lê coords de      │
  │                                    │      todos os {{key}} no documento      │
  │                                    │      → salva em field_positions no FS   │
  │                                    │      (próximo save usa coord, não texto) │
  │                                    │                                         │
  │                                    │  11. Firestore.update({                 │
  │                                    │       schema_campos,                    │
  │                                    │       arquivo_fillable_url,             │
  │                                    │       field_positions (com coords),     │
  │                                    │       fillable_status: "pronto"         │
  │                                    │      })                                 │
  │                                    │                                         │
  │                                    │  12. revalidatePath(...)                │
  │                                    │      Invalida cache do Next.js          │
  │                                    └─────────────────────────────────────────┘
  │
  └─ EXIBIR DOCUMENTO ATUALIZADO
      previewVersion++ → DocxInteractive re-executa fetch
      GET /api/templates/{id}/arquivo?fresh=1&v={n}
        → serve arquivo_fillable_url atualizado do Blob
      docx-preview renderAsync() → DOM atualizado
      colorChips() → chips visuais nos novos tokens
```

### Estrutura de dados no Firestore — `magis_templates/{id}` (completa)

```typescript
{
  user_id: string,
  nome: string,
  arquivo_url: string,            // original.docx — NUNCA sobrescrito
  arquivo_fillable_url: string,   // fillable.docx — sobrescrito a cada save
  fillable_status: "pronto" | "processando" | "erro",
  schema_campos: TemplateFieldSchema[],
  // { key, label, type, required, role, group, injection_pattern,
  //   placeholder, helperText, aiInstructions, defaultValue }
  field_positions: {              // posições persistidas (coord > texto)
    professor: { cellText: "Professor(a):", ordinal: 0, coord: "T1R2C3" },
    turma:     { cellText: "Turma:",        ordinal: 0, coord: "T1R3C1" },
    // ...
  },
  metadata_padrao: Record<string, string>,  // valores fixos (escola, ano)
  tipo_plano: string | null,
  estado: string | null,
}
```

### Arquivos — Fluxo 2

| Arquivo | Papel |
|---|---|
| `app/dashboard/templates/[id]/editar/page.tsx` | Server Page — lê Firestore, passa props |
| `components/templates/template-field-editor.tsx` | Client Component — editor completo |
| `lib/utils/docx-anchor-fix.ts` | Reposiciona logos ancorados no HTML renderizado |
| `lib/utils/docx-coord.ts` | Atribui `data-xml-coord` às células do DOM |
| `app/api/templates/[id]/arquivo/route.ts` | Serve fillable ou original do Blob |
| `app/api/templates/[id]/schema/route.ts` | Pipeline de injeção completo (save) |
| `lib/utils/docx-filler.ts` | Todas as funções de injeção e normalização |

### Invariante central — Immutable Base Pattern

O original (`arquivo_url`) **nunca é modificado**. A cada save, o fillable é **sempre regenerado do zero** a partir do original. Isso elimina três classes de bug:

1. **Ghost tokens** — campos deletados não sobrevivem entre saves
2. **Position drift** — label-matching não re-injeta em célula errada
3. **State accumulation** — erros não se acumulam iteração a iteração
