# Regras Determinísticas — Mapeamento de Campos e Placeholders

Derivadas da análise estrutural de três templates reais da rede EMIEP/CEDUP-SC:
- `C-Planejamento anual - EMIEP-2026 - com variaveis.docx` (28 placeholders)
- `Plano_30dias_5421_13-07_a_09-08_2026 - com variaveis.docx` (13 placeholders)
- `Plano de aula - com variaveis.docx` (16 placeholders)

---

## 1. Sintaxe dos Placeholders

```
{{ nome_da_variavel }}
```

- Delimitadores: `{{` e `}}`
- Espaços internos opcionais (ex: `{{turma}}` e `{{ turma }}` são equivalentes)
- Sempre snake_case minúsculo em português
- Sem acentos ou caracteres especiais
- Acrônimos preservados em minúsculo: `bncc`, `ch` (carga horária)

**Regex de detecção:** `\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}`

---

## 2. Padrões Estruturais de Posicionamento (como o placeholder aparece no DOCX)

Há exatamente **4 padrões estruturais** observados. Aplicar na ordem de prioridade abaixo.

### P1 — LEFT_CELL (célula esquerda = rótulo, célula direita = valor)
```
┌────────────────────────────┬──────────────────────────────┐
│  Professor(a):             │  {{professor}}               │
└────────────────────────────┴──────────────────────────────┘
```
**Critério de detecção:** Linha de tabela com N colunas (N ≥ 2); a célula do índice `col - 1` contém apenas texto de rótulo (sem `{{}}`); a célula atual contém apenas `{{variavel}}`.

**Regra de rótulo:** `LABEL = texto da célula imediatamente à esquerda (col_idx - 1), na mesma linha`

Exemplos encontrados:

| Rótulo (col esquerda)                           | Placeholder (col direita)              |
|-------------------------------------------------|----------------------------------------|
| `PROFESSOR (A):`                                | `{{nome_prof}}`                        |
| `CURSO`                                         | `{{nome_curso}}`                       |
| `Área(s) do Conhecimento:`                      | `{{area_conhecimento}}`                |
| `Nº aulas semanais:`                            | `{{numero_aulas}}`                     |
| `Turma(s):`                                     | `{{turma}}`                            |
| `Componente Curricular` / `Componentes Curriculares:` | `{{componente_curricular}}`     |
| `OBJETIVO GERAL DO COMPONENTE:`                 | `{{objetivo_geral_componente}}`        |
| `COMPETÊNCIAS GERAIS BNCC:`                     | `{{competencias_gerais_bncc}}`         |
| `COMPETÊNCIAS ESPECÍFICAS DA ÁREA:`             | `{{competencias_especificas_area}}`    |
| `Escola:`                                       | `{{escola}}`                           |
| `Professor(a):`                                 | `{{professor}}`                        |
| `Período:`                                      | `{{periodo}}`                          |
| `Experiências de ensino e aprendizagem`         | `{{experiencia_ensino_aprendizagem}}`  |
| `Recursos necessários`                          | `{{recursos}}`                         |

---

### P2 — PREV_ROW (linha anterior = rótulo, linha atual = valor)
```
┌───────────────────────────────────────────────┐
│  METODOLOGIA                                  │  ← linha rótulo (1 célula ou N células, sem {{}})
├───────────────────────────────────────────────┤
│  {{metodologia}}                              │  ← linha valor
└───────────────────────────────────────────────┘
```
**Critério de detecção:** Linha atual contém apenas `{{variavel}}` em `col_idx 0`; a linha imediatamente anterior (ou a mais próxima não vazia, sem `{{}}`) na mesma coluna contém o rótulo.

**Regra de rótulo:** `LABEL = texto da linha anterior, mesma coluna`

Exemplos encontrados:

| Rótulo (linha anterior)                                              | Placeholder (linha atual)              |
|----------------------------------------------------------------------|----------------------------------------|
| `PLANO DE ARTICULAÇÃO COM 2º PROFESSORES, ADAPTAÇÕES/ADEQUAÇÕES CURRICULARES` | `{{articulacao_2professor}}`  |
| `PROJETOS INTEGRADORES`                                              | `{{projeto_integrador}}`               |
| `METODOLOGIA`                                                        | `{{metodologia}}`                      |
| `AVALIAÇÃO`                                                          | `{{avaliacao}}`                        |
| `REFERÊNCIAS BIBLIOGRÁFICAS` / `Referências Bibliográficas`         | `{{referencias_bibliograficas}}`       |
| `Objeto(s) de conhecimento em estudo`                                | `{{objetos_conhecimento}}`             |
| `Habilidade(s) selecionada(s)`                                       | `{{habilidades}}`                      |
| `Expectativas de aprendizagem (objetivos)`                           | `{{expectativa_aprendizagem}}`         |
| `Instrumento(s) avaliativos utilizados`                              | `{{instrumentos_avaliativos}}`         |
| `Recuperação paralela da aprendizagem`                               | `{{recuperacao_paralela}}`             |
| `Adaptações e observações`                                           | `{{adaptacao_2professor}}`             |

---

### P3 — INLINE (rótulo e placeholder na mesma célula, placeholder no final)
```
┌───────────────────────────────────────────────────────────┐
│  Carga horária presencial: {{chpresencial}}               │
└───────────────────────────────────────────────────────────┘
```
**Critério de detecção:** A célula contém texto literal antes do `{{variavel}}`. O rótulo é o texto prefixo até o `{{`.

**Regra de rótulo:** `LABEL = texto antes do primeiro {{, com pontuação final (:, -, —) removida`

Exemplos encontrados:

| Prefixo inline (rótulo)                              | Placeholder                                      |
|------------------------------------------------------|--------------------------------------------------|
| `Carga horária presencial:`                          | `{{chpresencial}}`                               |
| `Carga horária não presencial:`                      | `{{chnpresencial}}`                              |
| `Carga horária prevista:`                            | `{{ch_prevista}}`                                |
| `Data ou período de realização:` (1º slot)           | `{{data_inicio}}`                                |
| `- ` (2º slot após `{{data_inicio}} -`)              | `{{data_fim}}`                                   |
| `Blumenau,`                                          | `{{data_atual}}`                                 |
| `CONCEITOS ESTRUTURANTES E OBJETOS DO CONHECIMENTO:` | `{{conceitos_esteruturantes_e_objetos_conhecimento}}` |
| `HABILIDADES:`                                       | `{{habilidades}}`                                |
| `OBJETIVOS DE APRENDIZAGEM:`                         | `{{objetivos_aprendizagem}}`                     |
| `ATIVIDADE PROPOSTA/ METODOLOGIA:`                   | `{{atividade_protosta_metodologia}}`             |
| `AVALIAÇÃO:`                                         | `{{avaliacao}}`                                  |
| `Recuperação paralela:`                              | `{{recuperacao_paralela}}`                       |

**Sub-caso INLINE-MULTI:** múltiplos placeholders numa mesma célula sem separação de linha. O rótulo de cada um é o texto entre o final do placeholder anterior e o `{{` atual.

```
Professor(a): {{professor}} Área/Componente: {{area_componente}} Turma: {{turma}}
```
Algoritmo de extração:
```
segmentos = split_por_pattern(celula, r'\{\{[^}]+\}\}')
para cada placeholder[i]:
    label[i] = segmentos[i].strip().rstrip(':').strip()
```

---

### P4 — HEADER_TABLE (tabela de grade com cabeçalhos de coluna e sub-cabeçalhos de linha)
```
┌──────────────────────┬───────────────┬────────────────────────┬──────────────┐
│ CONCEITOS ESTRUTUR.  │ HABILIDADES   │ OBJETO DE CONHECIMENTO │  TRIMESTRE   │
├──────────────────────┼───────────────┼────────────────────────┼──────┬───┬───┤
│                      │               │                        │  1º  │2º │3º │
├──────────────────────┼───────────────┼────────────────────────┼──────┼───┼───┤
│{{conceitos_tr1}}     │{{habilidades_tr1}} │{{objeto_tr1}}     │{{tr1}}│   │   │
├──────────────────────┼───────────────┼────────────────────────┼──────┼───┼───┤
│{{conceitos_tr2}}     │{{habilidades_tr2}} │{{objeto_tr2}}     │   │{{tr2}}│   │
└──────────────────────┴───────────────┴────────────────────────┴──────┴───┴───┘
```
**Critério de detecção:** Tabela com N ≥ 4 colunas, linha de cabeçalho (row 0) sem `{{}}`, linha de sub-cabeçalho numérico ordinal (`1º`, `2º`, `3º`), linhas de dados contendo `{{variavel_trN}}`.

**Regra de rótulo composto:** `LABEL = HEADER_COL + "_" + SUBHEADER`  
Ex: `"HABILIDADES" + "_" + "1º"` → sufixo `_tr1`

**Mapeamento de sufixo ordinal:**
```
"1º" → _tr1
"2º" → _tr2
"3º" → _tr3
"1" / "I"  → _tr1   (variantes)
"2" / "II" → _tr2
"3" / "III"→ _tr3
```

---

## 3. Regra de Nomenclatura: Rótulo → Nome do Placeholder

### Algoritmo geral
```
1. Normalizar rótulo:
   a. Remover acentos e caracteres especiais → NFD decompose → strip non-ASCII
   b. Converter para minúsculo
   c. Remover pontuação final (:, /, -)
   d. Colapsar espaços múltiplos em único

2. Substituir termos por abreviações canônicas (tabela de termos abaixo)

3. Remover stop words não-semânticas: "de", "do", "da", "e", "ou", "com", "em"
   EXCETO quando formam parte de termos compostos canônicos

4. Juntar tokens com underscore (_)

5. Aplicar sufixo de dimensão temporal se em HEADER_TABLE (ex: _tr1)

6. Resultado deve ter ≤ 40 caracteres; se exceder, truncar pelo lado direito por token
```

### Tabela de abreviações canônicas

| Termo original                              | Abreviação                    |
|---------------------------------------------|-------------------------------|
| `professor`, `professora`, `professor(a)`   | `professor`                   |
| `nome do professor`                         | `nome_prof`                   |
| `carga horária presencial`                  | `chpresencial`                |
| `carga horária nao presencial`              | `chnpresencial`               |
| `carga horária prevista`                    | `ch_prevista`                 |
| `area(s) do conhecimento`                   | `area_conhecimento`           |
| `area componente`                           | `area_componente`             |
| `componente(s) curricular(es)`              | `componente_curricular`       |
| `turma(s)`                                  | `turma`                       |
| `objetivo(s) geral(is) do componente`       | `objetivo_geral_componente`   |
| `competencias gerais bncc`                  | `competencias_gerais_bncc`    |
| `competencias especificas da area`          | `competencias_especificas_area` |
| `conceitos estruturantes da area`           | `conceitos_estruturantes`     |
| `objeto(s) de conhecimento`                 | `objeto_conhecimento` / `objetos_conhecimento` |
| `habilidade(s) selecionada(s)`              | `habilidades`                 |
| `expectativas de aprendizagem`              | `expectativa_aprendizagem`    |
| `objetivos de aprendizagem`                 | `objetivos_aprendizagem`      |
| `instrumento(s) avaliativos`                | `instrumentos_avaliativos`    |
| `experiencias de ensino e aprendizagem`     | `experiencia_ensino_aprendizagem` |
| `recursos necessarios`                      | `recursos`                    |
| `recuperacao paralela`                      | `recuperacao_paralela`        |
| `adaptacoes e observacoes`                  | `adaptacao_2professor`        |
| `plano de articulacao com 2o professores`   | `articulacao_2professor`      |
| `projetos integradores`                     | `projeto_integrador`          |
| `metodologia`                               | `metodologia`                 |
| `atividade proposta metodologia`            | `atividade_proposta_metodologia` |
| `avaliacao`                                 | `avaliacao`                   |
| `referencias bibliograficas`                | `referencias_bibliograficas`  |
| `tematica abordada`                         | `tematica_abordada`           |
| `periodo`                                   | `periodo`                     |
| `numero aulas semanais` / `no aulas semanais` | `numero_aulas`              |
| `escola`                                    | `escola`                      |
| `curso`                                     | `nome_curso`                  |
| `data atual`                                | `data_atual`                  |
| `data inicio` / `data de inicio`            | `data_inicio`                 |
| `data fim` / `data de fim`                  | `data_fim`                    |
| `trimestre 1` / `1o trimestre`              | `tr1`                         |
| `trimestre 2` / `2o trimestre`              | `tr2`                         |
| `trimestre 3` / `3o trimestre`              | `tr3`                         |

---

## 4. Mapeamento Semântico Canônico (campo → grupo + role)

Todo placeholder pertence a um **grupo** e tem um **role** (quem preenche).

```typescript
type Role  = "manual" | "ia_sugerida" | "sistema"
type Group = "dados_turma" | "objetivos" | "competencias" | "habilidades"
           | "conteudos" | "avaliacao" | "outros"
```

### Tabela canônica completa

| Placeholder canônico                              | group              | role          | Observações |
|---------------------------------------------------|--------------------|---------------|-------------|
| `professor` / `nome_prof`                         | `dados_turma`      | `manual`      | nome_prof é alias |
| `escola`                                          | `dados_turma`      | `manual`      | |
| `nome_curso`                                      | `dados_turma`      | `manual`      | |
| `area_conhecimento` / `area_componente`           | `dados_turma`      | `manual`      | area_componente funde área+componente |
| `componente_curricular`                           | `dados_turma`      | `manual`      | |
| `turma`                                           | `dados_turma`      | `manual`      | |
| `periodo`                                         | `dados_turma`      | `manual`      | |
| `numero_aulas`                                    | `dados_turma`      | `manual`      | |
| `chpresencial`                                    | `dados_turma`      | `manual`      | |
| `chnpresencial`                                   | `dados_turma`      | `manual`      | |
| `ch_prevista`                                     | `dados_turma`      | `manual`      | |
| `data_inicio`                                     | `dados_turma`      | `manual`      | |
| `data_fim`                                        | `dados_turma`      | `manual`      | |
| `data_atual`                                      | `dados_turma`      | `sistema`     | Gerado automaticamente |
| `objetivo_geral_componente`                       | `objetivos`        | `ia_sugerida` | |
| `objetivos_aprendizagem`                          | `objetivos`        | `ia_sugerida` | |
| `expectativa_aprendizagem`                        | `objetivos`        | `ia_sugerida` | |
| `tematica_abordada`                               | `objetivos`        | `manual`      | |
| `competencias_gerais_bncc`                        | `competencias`     | `ia_sugerida` | |
| `competencias_especificas_area`                   | `competencias`     | `ia_sugerida` | |
| `habilidades` / `habilidades_tr1/2/3`            | `habilidades`      | `ia_sugerida` | |
| `objeto_conhecimento` / `objeto_conhecimento_tr1/2/3` / `objetos_conhecimento` | `conteudos` | `ia_sugerida` | |
| `conceitos_estruturantes` / `conceitos_estruturantes_tr1/2/3` | `conteudos` | `ia_sugerida` | |
| `conceitos_esteruturantes_e_objetos_conhecimento` | `conteudos`        | `ia_sugerida` | typo no original; funde dois campos |
| `metodologia`                                     | `conteudos`        | `ia_sugerida` | |
| `atividade_proposta_metodologia` / `atividade_protosta_metodologia` | `conteudos` | `ia_sugerida` | segundo é typo |
| `experiencia_ensino_aprendizagem`                 | `conteudos`        | `ia_sugerida` | |
| `recursos`                                        | `conteudos`        | `manual`      | |
| `avaliacao`                                       | `avaliacao`        | `ia_sugerida` | |
| `instrumentos_avaliativos`                        | `avaliacao`        | `manual`      | |
| `recuperacao_paralela`                            | `avaliacao`        | `manual`      | |
| `articulacao_2professor`                          | `outros`           | `manual`      | |
| `adaptacao_2professor`                            | `outros`           | `manual`      | |
| `projeto_integrador`                              | `outros`           | `ia_sugerida` | |
| `referencias_bibliograficas`                      | `outros`           | `manual`      | |
| `tr1` / `tr2` / `tr3`                            | `dados_turma`      | `manual`      | datas/períodos dos trimestres |

---

## 5. Regras de Equivalência Cross-Document

Quando o mesmo conceito aparece com nomes diferentes em documentos distintos, usar o alias canônico na introspection e registrar o alias original como `original_key`.

| Conceito canônico           | Alias PLANEJAMENTO ANUAL       | Alias PLANO 30 DIAS                                | Alias PLANO AULA              |
|-----------------------------|--------------------------------|----------------------------------------------------|-------------------------------|
| professor                   | `nome_prof`                    | `professor` (inline)                               | `professor`                   |
| area_conhecimento           | `area_conhecimento`            | `area_componente` (funde componente)               | `area_conhecimento`           |
| habilidades                 | `habilidades_tr1/2/3`          | `habilidades`                                      | `habilidades`                 |
| objeto_conhecimento         | `objeto_conhecimento_tr1/2/3`  | (fundido em `conceitos_esteruturantes_e_objetos_conhecimento`) | `objetos_conhecimento` |
| metodologia                 | `metodologia`                  | `atividade_protosta_metodologia` (typo)            | `experiencia_ensino_aprendizagem` |
| avaliacao                   | `avaliacao`                    | `avaliacao`                                        | `instrumentos_avaliativos`    |
| recuperacao_paralela        | —                              | `recuperacao_paralela`                             | `recuperacao_paralela`        |
| adaptacao_2professor        | `articulacao_2professor`       | —                                                  | `adaptacao_2professor`        |
| referencias_bibliograficas  | `referencias_bibliograficas`   | —                                                  | `referencias_bibliograficas`  |

---

## 6. Algoritmo de Detecção de Padrão (ordem de aplicação)

```
Para cada célula C de um DOCX com {{variavel}}:

  1. Se C tem texto literal ANTES do {{}}:
     → Padrão P3 (INLINE)
     → label = texto_antes_do_placeholder

  2. Se C está em col_idx > 0 E célula à esquerda (col_idx-1) tem texto sem {{}}:
     → Padrão P1 (LEFT_CELL)
     → label = texto_celula_esquerda

  3. Se linha anterior (ou 2 linhas acima) na mesma col_idx tem texto sem {{}}:
     → Padrão P2 (PREV_ROW)
     → label = texto_linha_anterior

  4. Se tabela tem ≥ 4 colunas E existe linha de sub-cabeçalhos ordinais (1º/2º/3º):
     → Padrão P4 (HEADER_TABLE)
     → label = header_col_0 + sufixo trimestre

  5. Se nenhum contexto detectado:
     → label = nome_do_placeholder (fallback: usar o próprio nome como label)
```

---

## 7. Typos Canônicos a Normalizar

Os documentos originais contêm typos que **devem ser normalizados** ao criar o schema:

| Placeholder original (typo)                              | Placeholder normalizado                   |
|----------------------------------------------------------|-------------------------------------------|
| `conceitos_esteruturantes_e_objetos_conhecimento`        | `conceitos_estruturantes_e_objetos_conhecimento` |
| `atividade_protosta_metodologia`                         | `atividade_proposta_metodologia`          |

> Ao fazer introspection de um template que já usa o typo, registrar `original_key = "conceitos_esteruturantes..."` e usar a chave normalizada internamente.

---

## 8. Variáveis de Sistema (geradas automaticamente, não editáveis pelo professor)

| Placeholder     | Valor gerado                          | Momento de geração       |
|-----------------|---------------------------------------|--------------------------|
| `{{data_atual}}`| Data atual formatada: `DD/MM/YYYY`    | No momento do download   |
| `{{data_inicio}}`| Calculado pelo sistema ou manual     | Input do professor       |
| `{{data_fim}}`  | Calculado pelo sistema ou manual      | Input do professor       |
| `{{tr1}}` / `{{tr2}}` / `{{tr3}}` | Datas dos trimestres do calendário escolar | Input do professor |

---

## 9. Resumo por Tipo de Documento

### Tipo A — Planejamento Anual (EMIEP)
- **Escopo:** ano letivo completo, por componente
- **Estrutura:** 1 tabela principal, seções por trimestre em grade 6 colunas
- **Placeholders únicos:** `nome_prof`, `nome_curso`, `chpresencial`, `chnpresencial`, `competencias_gerais_bncc`, `competencias_especificas_area`, `conceitos_estruturantes_tr1/2/3`, `habilidades_tr1/2/3`, `objeto_conhecimento_tr1/2/3`, `tr1/2/3`, `articulacao_2professor`, `projeto_integrador`, `data_atual`
- **Campos IA:** objetivos, competências BNCC, habilidades, objetos, metodologia, avaliação, projetos

### Tipo B — Plano 30 Dias (CEDUP)
- **Escopo:** período de até 30 dias
- **Estrutura:** 1 tabela com células full-width, inline com múltiplos placeholders por célula
- **Placeholders únicos:** `area_componente`, `ch_prevista`, `data_inicio`, `data_fim`, `tematica_abordada`, `conceitos_esteruturantes_e_objetos_conhecimento`, `objetivos_aprendizagem`, `atividade_protosta_metodologia`
- **Campos IA:** conceitos+objetos (fundidos), habilidades, objetivos, metodologia, avaliação

### Tipo C — Plano de Aula / Sequência Didática
- **Escopo:** unidade didática, aula ou sequência
- **Estrutura:** 1 tabela com alternância entre linhas-rótulo e linhas-valor; seção de sequência didática em 2 colunas
- **Placeholders únicos:** `escola`, `periodo`, `numero_aulas`, `objetos_conhecimento`, `expectativa_aprendizagem`, `instrumentos_avaliativos`, `experiencia_ensino_aprendizagem`, `recursos`, `adaptacao_2professor`
- **Campos IA:** objetos, habilidades, expectativas, experiência de ensino

---

## 10. Checklist de Validação de Template

Ao fazer introspection de um novo DOCX, verificar:

- [ ] Todos os `{{` têm `}}` correspondente (sem placeholder aberto)
- [ ] Nenhum placeholder tem espaço ou acento no nome (ex: `{{área}}` → erro)
- [ ] Placeholders em tabela HEADER_TABLE têm sufixo `_tr1/2/3` consistente com sub-cabeçalho
- [ ] Campos de grupo `dados_turma` estão todos presentes (professor, turma, area_conhecimento são mínimos)
- [ ] `{{data_atual}}` nunca aparece em campo editável — sempre `role: "sistema"`
- [ ] Typos conhecidos são normalizados no schema interno
