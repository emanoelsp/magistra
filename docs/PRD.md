# PRD — PlanoMagistra

## Objetivo

Plataforma SaaS que reduz em 70% o tempo do professor para criar planos de aula, planejamentos anuais e outros documentos pedagógicos. O professor sobe o template oficial da escola, a IA extrai a estrutura e sugere conteúdo por campo (BNCC, CTBC, SAEB, competências, habilidades, conteúdos). O professor revisa, edita e baixa o documento pronto para entregar à escola.

## Público-alvo

Professores da educação básica (Infantil, Fundamental, Médio) que precisam preencher templates específicos de cada escola com referências pedagógicas corretas.

## Problema central

Cada escola tem um template Word diferente. O professor precisa:
1. Abrir o template no Word
2. Buscar manualmente referências BNCC, SAEB, CTBC na internet
3. Copiar e adaptar os conteúdos campo a campo
4. Salvar e postar no sistema da escola

Isso leva 2–4h por plano. O PlanoMagistra transforma isso em 20–30 minutos.

---

## Planos e limites (fase MVP)

| Plano | Templates | Planos/mês | Preço | Status |
|-------|-----------|-----------|-------|--------|
| Starter | 2 | 3 | R$ 19,90/mês | **Gratuito no MVP** – cadastro sem cobrança |
| Pro | 5 | 10 | R$ 49,90/mês | Em breve |
| Escola | ilimitado | ilimitado | Sob consulta | Em breve |

> No MVP, todo usuário cadastrado escolhe o plano Starter (gratuito). Pagamento e planos Pro/Escola serão implementados em fase posterior.

### Custo real de LLM por usuário Starter/mês
Gemini 2.0 Flash: ~$0,005 USD = R$ 0,03. Margem bruta do Starter: >99%. O custo de LLM é desprezível mesmo no plano Escola com equipes grandes.

---

## Fluxo principal

### 1. Cadastro e seleção de plano
- Usuário se cadastra com email/senha via Firebase Auth
- Seleciona plano "Médio" (mock — sem cobrança)
- Perfil salvo no Firestore com `plano: "medio"`

### 2. Upload de template
- Professor acessa "Meus templates"
- Informa nome da escola e tipo de plano (plano de aula, anual, sequência didática…)
- Faz upload de PDF ou DOCX
- A IA (Gemini) analisa o arquivo e extrai o schema de campos:
  - `role: "manual"` → professor preenche (escola, turma, professor, datas)
  - `role: "ia_sugerida"` → IA sugere conteúdo (objetivos, BNCC, habilidades, conteúdos)
- Template salvo no Firestore com schema

### 3. Edição do template (opcional)
- Professor pode editar os campos extraídos dentro do app
- Renomear campos, adicionar, remover, alterar role/group
- Salva atualização no Firestore

### 4. Criação de plano — Editor Word-like
- Professor seleciona um template e clica "Gerar novo plano"
- Abre editor split-view:
  - **Esquerda (60%):** formulário com todos os campos do template
    - Seção "Dados fixos": campos manuais (escola, turma, ano, disciplina, professor)
    - Seção "Conteúdo pedagógico": campos ia_sugerida com botão "✨ Sugerir"
  - **Direita (40%):** painel de sugestões da IA — reativo ao campo focado
    - Exibe 3–5 sugestões para o campo ativo
    - Cada sugestão tem botão "Inserir" que adiciona ao campo
    - Mostra contexto usado (turma, ano, disciplina)
    - Botão "✨ Gerar novas sugestões"
- Ao preencher os campos manuais, a IA auto-sugere os pedagógicos
- Professor pode digitar livremente em qualquer campo
- "Salvar rascunho" → persiste com status `rascunho`
- "Finalizar e baixar PDF" → salva com status `gerado` e inicia download PDF

### 5. Histórico
- Lista todos os planos criados
- Status: rascunho, gerado, erro
- Botão "Baixar PDF"

---

## Requisitos funcionais

- RF001: Autenticação email/senha via Firebase Auth
- RF002: Seleção de plano no cadastro (mock — sem pagamento)
- RF003: Upload de template PDF/DOCX com extração de campos via IA
- RF004: Edição in-app dos campos do template
- RF005: Editor split-view (esquerda: formulário, direita: painel IA)
- RF006: Sugestões IA por campo (BNCC, SAEB, CTBC, habilidades, competências, conteúdos)
- RF007: Auto-sugestão ao completar campos manuais (escola, turma, ano, disciplina)
- RF008: Inserção de sugestão com um clique no campo ativo
- RF009: Salvamento de rascunho + finalização com download PDF
- RF010: Controle de limites de plano (2 templates, 2 planos/mês no plano médio)
- RF011: Histórico de planos com download PDF
- RF012: Dashboard com estatísticas de uso

## Requisitos não funcionais

- RNF001: Resposta da IA em menos de 10s por campo
- RNF002: Interface responsiva (prioridade desktop)
- RNF003: Dados isolados por usuário no Firestore
- RNF004: Código TypeScript estrito
- RNF005: Build sem erros
- RNF006: Deploy na Vercel

## Critérios de aceite

- Professor consegue cadastrar, subir template e gerar plano completo em menos de 30 minutos
- IA sugere pelo menos 3 itens relevantes por campo pedagógico
- Sugestões são específicas para turma/ano/disciplina informados
- Download PDF contém todos os campos preenchidos
- Sistema bloqueia criação quando limite do plano é atingido
