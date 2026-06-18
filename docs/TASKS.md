# Tasks — PlanoMagistra

## Concluído

- [x] Estrutura base Next.js 15 + Firebase Auth + Firestore
- [x] Autenticação email/senha com session cookie seguro
- [x] Dashboard com estatísticas (templates, planos do mês, pendentes, tokens)
- [x] Upload de template (PDF/DOCX) + extração de schema via Gemini
- [x] Wizard legado de geração de planos (multi-step)
- [x] Sugestões IA em lote para campos ia_sugerida (`/api/gerar-plano`)
- [x] Histórico de planos com download PDF via `pdf-lib`
- [x] Sidebar com navegação e logout
- [x] **Editor split-view Word-like** (`/dashboard/planos/novo?template=[id]`)
- [x] **API por campo** (`/api/ia/campo`) — sugestão IA para um único campo
- [x] **Editor de campos do template** (`/dashboard/templates/[id]/editar`)
- [x] **Limites de plano** — verificação e exibição de uso
- [x] **Cadastro com seleção de plano** — onboarding pós-login (novo usuário → `/onboarding`)
- [x] **Botões na lista de templates** — "Novo plano", "Visualizar", "Editar", "Excluir"
- [x] **Download PDF melhorado** — campos agrupados por seção com cabeçalhos visuais
- [x] **Cache seguro** — user_id + schema hash na cache key (`suggestions-cache.server.ts`)
- [x] **Sanitização de prompt injection** (`/api/ia/campo` — função `sanitizeForPrompt`)
- [x] **Rate limiting** na IA (`lib/services/rate-limit.server.ts`)
- [x] **Telemetria de aceitação** (`/api/ia/aceitar` + `trackSugestaoAceita`)
- [x] **Validação pós-geração** (`lib/services/suggestion-validator.ts`)
- [x] **Fuzzy match BNCC** (`lib/services/bncc-rag.server.ts`)
- [x] **Paginação real** no histórico (`getUserPlanosComNome` com page/pageSize)
- [x] **Soft delete** de templates
- [x] **Validação BNCC** — regex de formato em `suggestion-validator.ts`
- [x] **Memória pedagógica** (`lib/services/pedagogic-memory.server.ts`)
- [x] **Versões do plano** (`/api/planos/[id]/versoes`)
- [x] **Bloqueio de edição pós-finalização** — `isFinalized` no editor
- [x] **Bug**: planos `aguardando_geracao` agora têm botão "Continuar editando" no histórico e dashboard
- [x] **Bug**: nome do template no histórico usa `conteudo_gerado.template_nome` como fallback quando template foi deletado
- [x] **Dashboard**: título do plano (`_plano_titulo`) mostrado em vez do nome do template quando disponível

## Pendente

- [ ] **Pagamento e outros planos** (fase futura — não implementar no MVP)
- [ ] **Preview do plano preenchido** inline na tela de detalhes (sem abrir aba)
- [ ] **Notificação de conclusão do DOCX fillable** — avisar o professor quando o processamento terminar
