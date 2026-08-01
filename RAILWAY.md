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

### Automatizado (script)

Há um script que faz tudo (projeto → deploy → volume → variável → domínio):

```bash
# 1. Token de CONTA do Railway: https://railway.com/account/tokens
export RAILWAY_API_TOKEN="seu_token_de_conta"

# 2. Rodar (opcional: PROJECT_NAME, WORKSPACE, MOUNT_PATH, DB_FILE)
./scripts/railway-setup.sh
```

> ⚠️ O ambiente precisa ter **egress liberado para `backboard.railway.com` e
> `railway.com`**. Sem isso, o CLI recebe `403` do proxy e nada conecta.

### Manual (passo a passo)

```bash
# Instalar e autenticar
npm i -g @railway/cli
railway login                # (interativo) — ou export RAILWAY_API_TOKEN=...

# Na raiz do projeto
railway init --name despesas-integradas   # cria/liga o projeto
railway up --ci --yes                      # faz o deploy (cria o serviço)

# Volume, variável e domínio
railway volume add --mount-path /data
railway variable set DATABASE_PATH=/data/expenses.db
railway domain                             # gera o domínio público
```

---

## Verificação pós-deploy

- **Healthcheck:** `https://SEU-DOMINIO.up.railway.app/health` → `{"status":"ok"}`
- **API:** `https://SEU-DOMINIO.up.railway.app/api/data` → JSON com os dados.
- **App:** a raiz `/` serve o SPA React.
- **Persistência:** crie uma despesa, faça um novo deploy e confirme que ela continua lá.

### O volume está mesmo ativo? (checagem em 5 segundos)

Abra `https://SEU-DOMINIO.up.railway.app/health`. A resposta mostra onde o banco está:

```json
{
  "status": "ok",
  "database": {
    "path": "/data/expenses.db",
    "persistent": true,
    "journal_mode": "wal",
    "expenses": 42
  }
}
```

- `"persistent": true` → o banco está no volume; os dados sobrevivem aos deploys. ✅
- `"persistent": false` → **o banco está no disco efêmero e some no próximo deploy.**
  Volte ao passo 2 (criar o volume em `/data`) e ao passo 3 (`DATABASE_PATH=/data/expenses.db`).
  O log do serviço também mostra esse aviso no boot.

---

## Instalar no celular (PWA)

O app é um **PWA**: dá para instalar na tela de início e ele **abre mesmo sem internet**
(os lançamentos feitos offline entram na fila e sobem sozinhos ao reconectar).

- **Android / Chrome:** abra o domínio → menu ⋮ → *Instalar app* / *Adicionar à tela inicial*.
- **iPhone / Safari:** abra o domínio → botão *Compartilhar* → *Adicionar à Tela de Início*.

Depois de instalado, a primeira abertura com internet baixa o app inteiro para o aparelho.
A partir daí ele abre offline. Como o service worker usa `autoUpdate`, cada deploy novo
no Railway chega ao aparelho automaticamente na próxima abertura.

> O service worker só existe no build de produção (`npm run build`). Em `npm run dev` ele
> fica desligado de propósito, para não brigar com o HMR do Vite.

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
