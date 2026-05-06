# Backlog — PlanoMagistra

## Em progresso / Próximos

### RAG sobre BNCC + SAEB
- Vetorizar documentos oficiais (BNCC, SAEB, CTBC) com `text-embedding-004`
- Armazenar vetores em pgvector (Supabase) ou Pinecone
- No `/api/ia/campo`, recuperar os N chunks mais relevantes antes de gerar
- Elimina alucinação de códigos curriculares — principal risco de perda de confiança do professor

---

## Backlog

### Geração em batch ao completar dados fixos
- Hoje gera campo por campo on-demand
- Quando `metadataComplete` fica `true`, disparar geração de todos os campos IA em paralelo
- Professor abre o editor já com sugestões prontas, sem precisar clicar campo a campo

### Streaming na geração de sugestões
- Hoje o painel fica vazio por 4-8s e aparece tudo de uma vez
- `ReadableStream` + `TransformStream` no Next.js route handler
- Frontend consome via `EventSource` ou `fetch` com `getReader()`
- Sensação de resposta imediata mesmo em modelos lentos

### RAG sobre PPP/currículo da escola
- Professor sobe o Projeto Político-Pedagógico da escola
- Vetorizar e associar ao template (`template_id`)
- Sugestões alinhadas ao currículo específico daquela escola
- Principal diferenciador competitivo no médio prazo

### Feedback de qualidade nas sugestões
- Thumbs up/down por sugestão
- Salvar em Firestore: `suggestions_feedback/{id}` com `field_key`, `sugestao_id`, `rating`, `user_id`
- Usar para refinar prompts e identificar campos com baixa qualidade sistêmica

### Invalidação de cache ao "Gerar novas sugestões"
- Hoje o botão "Gerar novas sugestões" no painel pode retornar o cache
- Adicionar flag `bypassCache: true` no body quando o professor pede explicitamente novas sugestões
- Cache continua válido para o primeiro acesso

### Versionamento de templates
- Professores atualizam o template da escola ao longo do ano
- Planos antigos devem continuar funcionando com o schema original
- Salvar `schema_version` no plano no momento da criação
