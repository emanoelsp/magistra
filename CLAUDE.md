# CLAUDE.md — PlanoMestre

## O que é este projeto

SaaS para professores da educação básica brasileira. Reduz em 70% o tempo de preenchimento de planos de aula. O professor sobe o template da escola, a IA extrai a estrutura e sugere conteúdo por campo (BNCC, SAEB, CTBC). O professor edita no editor split-view e baixa o PDF pronto.

Leia `docs/PRD.md` para requisitos completos, `docs/ARCHITECTURE.md` para a stack e estrutura.

## Comandos essenciais

```bash
npm run dev          # servidor de desenvolvimento (porta 3000)
npm run build        # build de produção
npm run typecheck    # verificação TypeScript sem emitir
npm run lint         # ESLint
```

## Stack

- **Next.js 15** com App Router (Server Components por padrão)
- **TypeScript** estrito
- **Firebase Auth** + **Firestore** (Admin SDK no servidor, Client SDK no cliente)
- **Google Gemini** via `@google/generative-ai`
- **Tailwind CSS** (sem shadcn/ui — componentes escritos à mão)
- **pdf-lib** (download PDF), **pdf-parse** (extração de texto)

## Variáveis de ambiente necessárias

```
GOOGLE_GEMINI_API_KEY=
GOOGLE_GEMINI_MODEL=gemini-2.0-flash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

## Regras de desenvolvimento

### Server vs. Client

- Server Components: busca de dados (Admin SDK, session), páginas sem interatividade
- Client Components (`"use client"`): formulários, estado local, eventos, chamadas fetch
- Nunca importar `firebase/admin` em Client Components
- `"server-only"` obrigatório em arquivos do Admin SDK e session

### Firestore

- Admin SDK: `lib/firebase/admin.ts` → `getAdminDb()`
- Client SDK: `lib/firebase/client.ts` → `firebaseDb`
- Services client-side: `lib/services/firestore/*.service.ts`
- Services server-side: `lib/services/firestore/*.server.ts`
- Queries sempre filtradas por `user_id == uid`

### Tipos

- Todos os tipos em `lib/types/firestore.ts`
- `TemplateFieldSchema`: campos do schema (key, label, type, role, group)
- `role: "manual"` → professor preenche; `role: "ia_sugerida"` → IA sugere
- `group`: dados_turma | objetivos | competencias | habilidades | conteudos | avaliacao | outros

### Limites de plano

- Verificar com `lib/services/limits.ts` antes de criar template ou plano
- Plano médio: 2 templates, 2 planos/mês
- Todo usuário começa com `plano: "medio"` (mock MVP — sem pagamento)

### IA

- Sempre usar `responseMimeType: "application/json"` para evitar markdown wrapper
- Retry até 3x para erros 503/429/RECITATION
- Parsear JSON com fallback: localizar primeiro `{`/`[` e último `}`/`]`
- Nunca reproduzir texto literal de documentos oficiais (instrução no prompt)

### UI

- Inputs: `rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950`
- Cards: `rounded-3xl border border-slate-200 bg-white p-6 shadow-sm`
- Botão primário: `rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white`
- Botão IA: `rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white`
- Botão sucesso: `rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white`

## Fluxo de dados — editor split-view

1. Server page busca template pelo Admin SDK
2. Client component `PlanEditor` recebe schema_campos como prop
3. Estado local: `values` (Record<string, string>), `activeFieldKey`, `suggestions`, `planoId`
4. Campo focado → painel direito mostra sugestões via `POST /api/ia/campo`
5. "Inserir" → adiciona texto ao campo ativo
6. "Salvar rascunho" → `planosService.createPlano/updatePlano`
7. "Finalizar" → atualiza status para `gerado` → `window.open(/api/planos/[id]/download)`

## Não fazer

- Não usar `git add -A` — adicionar arquivos específicos
- Não commitar `.env.local`
- Não usar `any` em TypeScript — usar tipos explícitos ou `unknown`
- Não criar componentes com estado sem `"use client"`
- Não acessar Admin SDK em Client Components
- Não implementar pagamento no MVP (manter mock)
