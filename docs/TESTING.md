# Estratégia de Testes

## Stack de testes

- Jest
- React Testing Library
- Cypress

## Testes unitários com Jest

Usar para:
- Funções utilitárias
- Hooks
- Schemas Zod
- Services
- Regras de negócio

## Testes de componente com React Testing Library

Usar para:
- Componentes reutilizáveis
- Formulários
- Estados de loading
- Estados de erro
- Interações do usuário

## Testes E2E com Cypress

Usar para fluxos críticos:
- Login
- Cadastro
- Logout
- Dashboard
- CRUD principal
- Fluxos de pagamento (se existir)

## Regras obrigatórias

- Toda feature nova deve ter teste.
- Todo bug corrigido deve ter teste cobrindo o caso.
- Não criar testes frágeis.
- Priorizar comportamento do usuário.
- Evitar testar detalhes internos de implementação.
- Rodar testes antes de finalizar tarefa.

## Scripts esperados

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "cypress open",
    "test:e2e:run": "cypress run",
    "test:ci": "jest && cypress run",
    "lint": "next lint",
    "build": "next build"
  }
}
```
