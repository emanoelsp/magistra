# Arquitetura — PlanoMestre

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
