# CLAUDE.md — PlanoMagistra

## O que é este projeto

SaaS para professores da educação básica brasileira. Reduz em 70% o tempo de preenchimento de planos de aula. O professor sobe o template da escola, a IA extrai a estrutura e sugere conteúdo por campo (BNCC, SAEB, currículos territoriais). O professor edita no editor split-view e baixa o PDF pronto.

Leia `docs/PRD.md` para requisitos completos, `docs/ARCHITECTURE.md` para a stack e estrutura.

## Comandos essenciais

```bash
npm run dev          # servidor de desenvolvimento (porta 3000)
npm run build        # build de produção
npm run typecheck    # verificação TypeScript sem emitir
npm run lint         # ESLint
npm test             # vitest (tests/**/*.test.ts)
```

## Stack

- **Next.js 15** com App Router (Server Components por padrão)
- **TypeScript** estrito
- **Firebase Auth** + **Firestore** (Admin SDK no servidor, Client SDK no cliente)
- **IA multi-provider** via `lib/ai/provider.ts` — cadeia de fallback: Claude (`@anthropic-ai/sdk`, primário) → Gemini → OpenAI → Groq → Ollama
- **Pinecone** para RAG (BNCC, SAEB, currículos territoriais) — `lib/services/bncc-rag.server.ts`
- **Mercado Pago** para pagamentos — `app/api/pagamentos/{checkout,webhook}` (planos mensais e créditos avulsos)
- **Tailwind CSS** (sem shadcn/ui — componentes escritos à mão)
- **pdf-lib** (download PDF), **pdf-parse** (extração de texto), **docx-filler** (injeção em DOCX)
- **Vitest** para testes

## Variáveis de ambiente

Principais (lista completa: `grep -r "process.env" lib/ app/`):

```
ANTHROPIC_API_KEY= / ANTHROPIC_MODEL=          # provider primário
GOOGLE_GEMINI_API_KEY= / GOOGLE_GEMINI_MODEL=  # fallback 1
OPENAI_API_KEY= / GROQ_API_KEY=                # fallbacks 2 e 3
PINECONE_API_KEY= / PINECONE_INDEX=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
NEXT_PUBLIC_FIREBASE_*=                        # API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID
MERCADOPAGO_ACCESS_TOKEN= / MERCADOPAGO_WEBHOOK_SECRET=
BLOB_READ_WRITE_TOKEN=                         # Vercel Blob (arquivos de template)
```

## Regras de desenvolvimento

### Server vs. Client

- Server Components: busca de dados (Admin SDK, session), páginas sem interatividade
- Client Components (`"use client"`): formulários, estado local, eventos, chamadas fetch
- Nunca importar `firebase/admin` em Client Components
- `"server-only"` obrigatório em arquivos do Admin SDK, session e providers de IA

### Firestore

- Admin SDK: `lib/firebase/admin.ts` → `getAdminDb()`
- Client SDK: `lib/firebase/client.ts` → `firebaseDb`
- Services client-side: `lib/services/firestore/*.service.ts`
- Services server-side: `lib/services/firestore/*.server.ts`
- Queries sempre filtradas por `user_id == uid`

### Tipos

- Todos os tipos em `lib/types/firestore.ts`
- `TemplateFieldSchema`: campos do schema (key, label, type, group, classe, origem)
- `classe`: perfil (dado fixo do professor) | pedagogico (IA + RAG mensal) | contextual (calculado por plano)
- `origem`: ia | manual | regra
- `role` (`manual`/`ia_sugerida`) está **deprecado** — mantido por compat; inferir via `classe`

### Limites de plano e pricing

- **Fonte de verdade do enforcement**: `lib/services/plan-config.ts` (`PLAN_LIMITS`, `PLAN_PRICES_BRL`, `PLAN_LABELS`) — nunca hardcodar limites em outro lugar
- A página de preços (`lib/services/plans.ts`) DERIVA os números de `plan-config.ts`; `tests/plans.test.ts` garante a consistência
- Verificar limites com `lib/services/limits.ts` antes de criar template ou plano (soma créditos avulsos)
- Todo usuário começa com `plano: "free"` (Explorador, trial de 90 dias); upgrade via Mercado Pago
- `avancado`/`premium` são SKUs legados do tier `pro` — não vender, não remover de `PLAN_LIMITS`

### IA

- Toda chamada passa por `lib/ai/provider.ts` (`callAIWithFallbacks`) — nunca instanciar SDK de provider direto em rota
- Sempre usar `responseMimeType: "application/json"` para evitar markdown wrapper
- Retry até 3x para erros 503/429/RECITATION
- Parsear JSON com fallback: localizar primeiro `{`/`[` e último `}`/`]`
- Nunca reproduzir texto literal de documentos oficiais (instrução no prompt)
- **Validação closed-world**: todo código BNCC/SAEB citado pela IA deve existir no contexto RAG. Fluxo canônico: `filterWithRetry()` em `lib/services/bncc-validator.ts` (filter → 1 regeneração → `precisaRevisao`). Utilidades de código (regex, `decompor`) em `lib/utils/bncc-code.ts`, espelhado em `scripts/ingest_bncc.py` — manter em sincronia

### UI

- Inputs: `rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950`
- Cards: `rounded-3xl border border-slate-200 bg-white p-6 shadow-sm`
- Botão primário: `rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white`
- Botão IA: `rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white`
- Botão sucesso: `rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white`
- Avisos de validação/adaptação: âmbar (`border-amber-200 bg-amber-50 text-amber-800`)
- Interações da Magis: balões de diálogo estilo WhatsApp (`ChatBubble` no plan-editor)

## Fluxo de dados — editor split-view

1. Server page busca template pelo Admin SDK
2. Client component `PlanEditor` (`components/planos/plan-editor.tsx`) recebe schema_campos como prop
3. Estado local: `values` (Record<string, string>), `activeFieldKey`, `suggestions`, `planoId`
4. Campo focado → painel direito mostra sugestões via `POST /api/ia/campo`
5. "Inserir" → adiciona texto ao campo ativo (sugestões `precisaRevisao` exigem confirmação em 2 cliques)
6. "Salvar rascunho" → `planosService.createPlano/updatePlano`
7. "Finalizar" → atualiza status para `gerado` → `window.open(/api/planos/[id]/download)`

## Não fazer

- Não usar `git add -A` — adicionar arquivos específicos
- Não commitar `.env.local`
- Não usar `any` em TypeScript — usar tipos explícitos ou `unknown`
- Não criar componentes com estado sem `"use client"`
- Não acessar Admin SDK em Client Components
- Não hardcodar limites/preços de plano — sempre derivar de `plan-config.ts`
- Não deixar o validador BNCC fail-open — sugestão sem validação sai marcada `precisaRevisao`
