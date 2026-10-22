# Deploy do backend Archilume (Railway ou Render)

## 1. Credenciais que você precisa conseguir antes

### Mercado Pago
1. Entre em https://www.mercadopago.com.br/developers/panel/app
2. Crie uma aplicação (se ainda não tiver).
3. Em "Credenciais de produção", copie o **Access Token**.
4. Cole em `MP_ACCESS_TOKEN` no `.env` (local) ou nas variáveis de ambiente do Railway/Render (produção).
   - Para testar sem usar dinheiro de verdade antes de ir ao ar: use as **credenciais de teste** (mesma tela, aba "Credenciais de teste") e os [cartões de teste do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test/cards).

### Resend (envio de e-mail)
1. Crie conta em https://resend.com
2. Em "API Keys", crie uma chave e cole em `RESEND_API_KEY`.
3. Por padrão o remetente é `onboarding@resend.dev` (funciona sem configurar domínio, mas é bom pra poucos envios de teste). Pra produção, verifique seu próprio domínio em "Domains" no Resend e troque `RESEND_FROM` para algo como `Archilume <contato@seudominio.com>`.

## 2. Deploy — opção A: Railway (CLI, não precisa de GitHub)

```bash
npm install -g @railway/cli
railway login          # abre o navegador pra você logar
cd archilume-backend
railway init            # cria um novo projeto Railway
railway up               # sobe o codigo desta pasta
```

Depois, no painel do Railway (railway.app), abra o projeto → Variables e adicione:

```
PORT=3900
ADMIN_SECRET=<escolha uma senha forte>
MP_ACCESS_TOKEN=<seu token do Mercado Pago>
RESEND_API_KEY=<sua chave do Resend>
RESEND_FROM=Archilume <onboarding@resend.dev>
APP_BASE_URL=https://seudominio.com.br
BACKEND_PUBLIC_URL=https://<seu-projeto>.up.railway.app
ALLOWED_ORIGINS=https://seudominio.com.br
```

Railway gera uma URL pública fixa tipo `https://archilume-backend-production.up.railway.app` — essa é a `BACKEND_PUBLIC_URL`.

## 2. Deploy — opção B: Render (precisa de um repositório Git)

```bash
cd C:\Users\MonkeyPC\Documents\claude
git init
git add archilume-backend
git commit -m "Backend Archilume"
# crie um repositorio no GitHub e troque <seu-usuario>/<repo> abaixo
git remote add origin https://github.com/<seu-usuario>/<repo>.git
git push -u origin main
```

Depois:
1. Entre em https://dashboard.render.com → New → Web Service.
2. Conecte o repositório do GitHub.
3. Root directory: `archilume-backend`.
4. Build command: `npm install`. Start command: `npm start`.
5. Em "Environment", adicione as mesmas variáveis listadas acima (troque `BACKEND_PUBLIC_URL` pela URL que o Render te der, tipo `https://archilume-backend.onrender.com`).

## 3. Depois que o backend estiver no ar

1. Teste: `curl https://<sua-url>/health` deve responder `{"ok":true}`.
2. Atualize o site (`archilume-site/.env.production` ou variável de ambiente do build):
   ```
   NEXT_PUBLIC_BACKEND_URL=https://<sua-url-do-backend>
   ```
3. Rode `npm run build` de novo no `archilume-site` e suba o novo `out/` no Hostinger (mesmo processo de sempre).
4. No backend, confirme que `APP_BASE_URL` aponta pro domínio real do site (onde fica a página `/sucesso`) e que `ALLOWED_ORIGINS` inclui esse mesmo domínio — senão o navegador bloqueia as chamadas por CORS.

## 4. Sem watchdog.ps1 em produção

O `watchdog.ps1` só existe porque estávamos rodando local no Windows. No Railway/Render o próprio serviço já reinicia sozinho se cair (`restartPolicy` no `railway.json` faz isso lá). Não precisa levar o watchdog para produção.
