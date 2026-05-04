# Tasks — PlanoMestre

## Concluído

- [x] Estrutura base Next.js 15 + Firebase Auth + Firestore
- [x] Autenticação email/senha com session cookie seguro
- [x] Dashboard com estatísticas (templates, planos do mês, pendentes, tokens)
- [x] Upload de template (PDF/DOCX) + extração de schema via Gemini
- [x] Wizard legado de geração de planos (multi-step)
- [x] Sugestões IA em lote para campos ia_sugerida (`/api/gerar-plano`)
- [x] Histórico de planos com download PDF via `pdf-lib`
- [x] Sidebar com navegação e logout

## Em progresso

- [ ] **Editor split-view Word-like** (`/dashboard/planos/novo?template=[id]`)
  - [ ] Toolbar com nome do template, status, botões Salvar/Finalizar
  - [ ] Painel esquerdo: formulário com campos do schema
  - [ ] Painel direito: sugestões IA por campo focado
  - [ ] Auto-sugestão quando campos manuais (escola/turma/ano/disciplina) são preenchidos
  - [ ] Inserção de sugestão com um clique
  - [ ] Salvamento como rascunho + finalização com download PDF

- [ ] **API por campo** (`/api/ia/campo`) — sugestão IA para um único campo
  - [ ] Recebe: templateId, fieldKey, fieldLabel, fieldGroup, metadata
  - [ ] Retorna: array de 3–5 sugestões `{ id, label, descricao?, fonte? }`

- [ ] **Editor de campos do template** (`/dashboard/templates/[id]/editar`)
  - [ ] Listar campos extraídos do template
  - [ ] Editar label, type, role, group de cada campo
  - [ ] Adicionar/remover campos
  - [ ] Salvar no Firestore

- [ ] **Limites de plano** (`lib/services/limits.ts`)
  - [ ] Verificar count de templates vs. limite do plano
  - [ ] Verificar count de planos do mês vs. limite
  - [ ] Exibir uso na página de templates (badge X/2)
  - [ ] Bloquear criação quando limite atingido

## Pendente

- [ ] **Cadastro com seleção de plano** — fluxo de onboarding pós-login
  - [ ] Tela de boas-vindas após primeiro login
  - [ ] Seleção de plano (apenas "Médio" habilitado, outros "Em breve")
  - [ ] Salva `plano: "medio"` no Firestore users/{uid}

- [ ] **Botões na lista de templates**
  - [ ] "Gerar novo plano" → `/dashboard/planos/novo?template=[id]`
  - [ ] "Editar campos" → `/dashboard/templates/[id]/editar`
  - [ ] "Excluir" (já existe)

- [ ] **Download PDF melhorado** — formatar com seções e labels legíveis

- [ ] **Pagamento e outros planos** (fase futura — não implementar no MVP)

## Bugs conhecidos

- O wizard `/dashboard/gerar` não mostra nome do template no histórico (exibe ID truncado)
- Status "aguardando_geracao" deveria ser "gerado" ao salvar pelo editor
