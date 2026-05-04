# Design System — PlanoMestre

## Princípios visuais

- **Limpo e profissional** — professores usam em ambiente de trabalho
- **Foco na tarefa** — o editor deve parecer uma ferramenta, não uma landing page
- **Feedback imediato** — toda ação tem resposta visual (loading, sucesso, erro)
- **Hierarquia clara** — campos manuais vs. campos sugeridos pela IA ficam visualmente distintos

## Paleta de cores

| Token | Uso |
|-------|-----|
| `slate-950` | Fundo de hero, botões primários, textos de título |
| `slate-50` | Fundo geral de páginas, painel IA direito |
| `white` | Cards, formulários, main content |
| `emerald-600` | Ações de sucesso, badges "Pronto", botão Finalizar |
| `emerald-50/300` | Backgrounds suaves de sucesso |
| `violet-600/50` | Painel IA — identificação visual |
| `amber-600/50` | Campos manuais — identificação visual |
| `rose-600` | Erros, ações destrutivas |
| `sky-600/50` | Campos em foco, estados ativos |

## Tipografia

- Fonte: system-ui (via Tailwind default)
- Títulos de página: `text-2xl font-semibold tracking-tight text-slate-950`
- Labels de campo: `text-sm font-medium text-slate-700`
- Helper text: `text-xs text-slate-500`
- Badges/capsulas: `text-xs font-semibold uppercase tracking-[0.2em]`

## Bordas e espaçamento

- Cards principais: `rounded-3xl border border-slate-200 bg-white p-6 shadow-sm`
- Cards inline: `rounded-2xl border border-slate-200`
- Inputs: `rounded-2xl border border-slate-300 px-4 py-3`
- Espaçamento entre seções: `space-y-6` ou `gap-6`

## Editor split-view (tela principal)

```
┌────────────────────────────────────────────────────────────────────┐
│  TOOLBAR                                                            │
│  [← Voltar]  [Nome do template]  ........  [Salvar] [Finalizar ↓] │
├──────────────────────────────────┬─────────────────────────────────┤
│  EDITOR (esquerda ~60%)          │  IA SUGESTÕES (direita ~40%)    │
│  fundo: white                    │  fundo: slate-50                │
│                                  │                                 │
│  ── Dados fixos ──               │  📌 Campo ativo: Habilidades    │
│  [label] [input rounded-2xl]     │  ─────────────────────────────  │
│  [label] [input]                 │  Sugestão 1                     │
│                                  │  EF05LP01 - Reconhecer...       │
│  ── Conteúdo pedagógico ──       │  [+ Inserir]                    │
│  [label]                ✨       │                                 │
│  [textarea]                      │  Sugestão 2                     │
│  [label]                ✨       │  EF05LP02 - Identificar...      │
│  [textarea highlighted]          │  [+ Inserir]                    │
│                                  │                                 │
│                                  │  [✨ Gerar novas sugestões]     │
│                                  │                                 │
│                                  │  ─────────────────────────────  │
│                                  │  Contexto: 5º ano · Port.       │
└──────────────────────────────────┴─────────────────────────────────┘
```

### Regras do editor

- Campo focado: `ring-2 ring-violet-400` no input/textarea
- Campo manual: label com badge `Dado fixo` em `amber-100 text-amber-700`
- Campo IA: label com ícone ✨ + botão "Sugerir" inline
- Painel direito: sticky, scroll independente do lado esquerdo
- Sugestão com badge de fonte: `(BNCC)`, `(SAEB)`, `(CTBC)` em `slate-500`

## Templates — Cards

```
┌────────────────────────────────────────┐
│  Nome do template               Pronto │
│  Escola · Tipo de plano                │
│  X campos · criado em DD/MM/AAAA       │
│                                        │
│  [Gerar novo plano]  [Editar]  [Excluir]│
└────────────────────────────────────────┘
```

## Estados obrigatórios

Todos os componentes interativos devem implementar:

- **loading** — spinner `animate-spin` ou skeleton
- **empty** — estado vazio com mensagem + CTA
- **error** — texto em `text-rose-600` + ação de retry se aplicável
- **success** — badge ou mensagem em `text-emerald-600`
- **disabled** — `opacity-50 cursor-not-allowed`

## Limites de plano — UX

Quando o usuário atingiu o limite:
- Badge no header da seção: `"2/2 templates usados"` em `rose-100 text-rose-700`
- Botão de upload/criação desabilitado com tooltip: "Limite do plano médio atingido"
- CTA para upgrade (futuro): link "Fazer upgrade"
