# Deploy no Railway — DESPESAS INTEGRADAS

Guia para publicar o app no [Railway](https://railway.app) usando **SQLite em um volume
persistente**. O banco continua sendo o `better-sqlite3` já usado no projeto — só apontamos
o arquivo `.db` para um volume que sobrevive a restarts e novos deploys.

---

## Visão geral

| Item | Valor |
|---|---|
| Builder | Nixpacks (padrão do Railway, configurado em `railway.json`) |
| Build | `npm run build` (gera o frontend em `dist/`) |
| Start | `npm run start` (`NODE_ENV=production tsx server.ts`) |
| Porta | injetada pelo Railway via `PORT` (o servidor já lê `process.env.PORT`) |
| Healthcheck | `GET /health` |
| Banco de dados | SQLite em `/data/expenses.db` (volume persistente) |

O deploy é **um único serviço** (backend Express + frontend React no mesmo processo).
Não é preciso criar um serviço de banco separado — o SQLite vive no volume.

---

## Passo a passo (Dashboard)

### 1. Criar o projeto
1. Acesse o [Railway](https://railway.app) e clique em **New Project → Deploy from GitHub repo**.
2. Selecione o repositório `dhigobar2-svg/despesas-integradas_app`.
3. Na aba **Settings → Branch**, escolha a branch que deseja publicar.

O Railway detecta o `railway.json` e usa automaticamente o build/start/healthcheck definidos.

### 2. Criar o volume persistente (banco de dados)
1. No serviço, abra a aba **Settings → Volumes** (ou **New → Volume**).
2. Clique em **Add Volume**.
3. Defina o **Mount Path** como:
   ```
   /data
   ```
4. Salve. O Railway cria um disco persistente montado em `/data`.

> ⚠️ **Importante:** sem o volume, o arquivo `expenses.db` fica no sistema de arquivos
> efêmero do container e **é apagado a cada novo deploy/restart**. O volume garante que
> os dados persistem.

### 3. Configurar as variáveis de ambiente
Na aba **Variables**, adicione:

| Variável | Valor | Obrigatória |
|---|---|---|
| `DATABASE_PATH` | `/data/expenses.db` | ✅ Sim — aponta o SQLite para o volume |
| `NODE_ENV` | `production` | Opcional — o `npm run start` já define |
| `GEMINI_API_KEY` | sua chave (se for usar a integração Gemini) | Opcional |

> Não defina `PORT` manualmente — o Railway injeta esse valor e o servidor já o respeita.

### 4. Gerar o domínio público
1. Aba **Settings → Networking → Public Networking**.
2. Clique em **Generate Domain**.
3. O Railway expõe a porta detectada e entrega uma URL `*.up.railway.app`.

### 5. Deploy
O primeiro deploy dispara automaticamente. A cada `git push` na branch conectada, o
Railway refaz build + deploy. Os dados no `/data` permanecem intactos entre deploys.

---

## Alternativa via CLI

```bash
# Instalar e autenticar
npm i -g @railway/cli
railway login

# Na raiz do projeto
railway init                 # cria/liga o projeto
railway up                   # faz o deploy

# Variáveis e volume
railway variables --set DATABASE_PATH=/data/expenses.db
railway volume add --mount-path /data
railway domain               # gera o domínio público
```

---

## Verificação pós-deploy

- **Healthcheck:** `https://SEU-DOMINIO.up.railway.app/health` → `{"status":"ok"}`
- **API:** `https://SEU-DOMINIO.up.railway.app/api/data` → JSON com os dados.
- **App:** a raiz `/` serve o SPA React.
- **Persistência:** crie uma despesa, faça um novo deploy e confirme que ela continua lá.

---

## Backup do banco

Como é um arquivo SQLite único no volume:

```bash
# Baixar o arquivo do volume via CLI (com o serviço em execução)
railway ssh
# dentro do container:
cat /data/expenses.db > /tmp/backup.db   # ou use o export JSON da própria UI (Configurações → Backup)
```

O app também oferece **export/restore de backup em JSON** na tela de Configurações, que é a
forma mais simples de mover os dados para fora do container.
