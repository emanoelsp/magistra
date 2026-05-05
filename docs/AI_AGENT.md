# Arquitetura de IA — PlanoMagistra

## Modelo

- **Gemini 2.0 Flash** (`gemini-2.0-flash`) via `@google/generative-ai`
- Configuração padrão: `temperature: 0.3, topP: 0.7, topK: 40`
- Formato de saída: `responseMimeType: "application/json"` (evita markdown wrapper)

## Agentes / Rotas de IA

### 1. Extração de schema — `/api/templates/introspect`

**Entrada:** PDF/DOCX em texto puro (via `pdf-parse`)

**Tarefa:** Analisar o template e extrair todos os campos como schema JSON.

**System prompt:**
> "Você analisa modelos de planos pedagógicos em PDF e devolve um schema JSON de campos. Campos de identificação (professor, turma, escola…) têm `role: manual`. Campos pedagógicos (objetivos, BNCC, habilidades, conteúdos…) têm `role: ia_sugerida`. Retorne SOMENTE um array JSON."

**Saída:** `TemplateFieldSchema[]`

**Few-shot:** Exemplo de schema com ~10 campos para calibrar o modelo.

---

### 2. Sugestões em lote — `/api/gerar-plano` (wizard legado)

**Entrada:** templateId, dadosManuais (turma, ano, disciplina), camposIaSugerida

**Tarefa:** Gerar sugestões para todos os campos ia_sugerida de uma vez.

**System prompt:**
> "Para cada campo solicitado, retorne um array de sugestões no formato `{ id, label, descricao?, fonte? }`. Baseie-se em BNCC, SAEB e CTBC. Parafraseie sempre. Retorne SOMENTE o JSON com chaves dos campos."

**Saída:** `Record<string, IaSugestao[]>`

---

### 3. Sugestão por campo — `/api/ia/campo` (editor split-view)

**Entrada:** templateId, fieldKey, fieldLabel, fieldGroup, metadata (escola/turma/ano/disciplina/etapa)

**Tarefa:** Gerar 3–5 sugestões específicas para um único campo, altamente contextualizadas pelo metadata fornecido.

**System prompt:**
> "Você é um especialista em currículo da educação básica brasileira. Gere 3 a 5 sugestões para o campo `{fieldLabel}` do grupo `{fieldGroup}`. Use o contexto: turma `{turma}`, ano `{ano}`, disciplina `{disciplina}`, etapa `{etapa}`. Baseie-se em BNCC, SAEB e CTBC quando aplicável. Retorne SOMENTE um JSON: `{ sugestoes: [{ id, label, descricao?, fonte? }] }`."

**Saída:** `{ sugestoes: IaSugestao[] }`

**Retry:** até 3 tentativas em erros 503/429/RECITATION.

---

## Boas práticas aplicadas

- **Nunca copiar literalmente** — o prompt instrui a parafrasear documentos oficiais
- **Nunca inventar códigos BNCC** — instrução explícita no system prompt
- **responseMimeType: "application/json"** — evita que o modelo envolva a resposta em markdown
- **JSON fallback** — se `JSON.parse` falhar, extrai pelo primeiro `[` / `{` e último `]` / `}`
- **Retry com backoff** — espera 2s × tentativa para 503/429
- **Retry para RECITATION** — reenvio com instrução de brevidade

## Limites de uso (controle de tokens)

- Campo `tokens_usados_mes` no Firestore `users/{uid}` (atualmente apenas monitorado, não enforced)
- Plano Médio: sem limite hard de tokens no MVP — apenas limite de planos/mês

## Evoluções futuras

- Trocar Gemini por Claude (Anthropic) para melhor qualidade nas sugestões pedagógicas
- Streaming de sugestões para UX mais rápida
- Cache de sugestões por campo+contexto (redis ou Firestore) para reduzir custos
- Validação das habilidades BNCC contra base de dados oficial
