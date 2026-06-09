# Deploy

## Plataforma padrão

- Vercel

## Regras

- O projeto deve passar no build antes do deploy.
- Variáveis de ambiente devem ficar no painel da Vercel.
- Nunca commitar secrets.
- Firebase config pública pode ficar no client, mas secrets privados não.

## Variáveis comuns

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

## Checklist antes do deploy

- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] Testar login
- [ ] Testar fluxo principal
- [ ] Testar responsividade
