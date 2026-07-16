#!/usr/bin/env bash
#
# railway-setup.sh — Provisiona e faz o deploy do app "Despesas Integradas" no
# Railway via CLI, ponta a ponta:
#   1. cria o projeto            (railway init)
#   2. sobe o deploy             (railway up  -> cria o serviço)
#   3. cria o volume persistente (railway volume add --mount-path /data)
#   4. aponta o SQLite p/ volume (railway variable set DATABASE_PATH=/data/expenses.db)
#   5. gera o domínio público    (railway domain)
#
# PRÉ-REQUISITOS
#   - Egress do ambiente liberado para os domínios do Railway
#     (backboard.railway.com e railway.com). Sem isso o CLI recebe 403 do proxy.
#   - Um TOKEN DE API DE CONTA/WORKSPACE do Railway (não um "project token"),
#     criado em: https://railway.com/account/tokens
#     Exporte-o antes de rodar:
#         export RAILWAY_API_TOKEN="seu_token_de_conta"
#
# USO
#   ./scripts/railway-setup.sh
#
# VARIÁVEIS OPCIONAIS
#   PROJECT_NAME    nome do projeto no Railway   (padrão: despesas-integradas)
#   WORKSPACE       ID/nome do workspace          (necessário se você tiver mais de um)
#   MOUNT_PATH      caminho do volume             (padrão: /data)
#   DB_FILE         nome do arquivo SQLite         (padrão: expenses.db)
#
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-despesas-integradas}"
MOUNT_PATH="${MOUNT_PATH:-/data}"
DB_FILE="${DB_FILE:-expenses.db}"
DB_PATH="${MOUNT_PATH%/}/${DB_FILE}"

# Diretório raiz do projeto (um nível acima de scripts/)
cd "$(dirname "$0")/.."

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[aviso] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[erro] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Checagens
# ---------------------------------------------------------------------------
command -v railway >/dev/null 2>&1 || {
  log "Railway CLI não encontrado — instalando via npm..."
  npm i -g @railway/cli >/dev/null 2>&1 || die "Falha ao instalar o Railway CLI."
}
log "Railway CLI: $(railway --version)"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
  die "Nenhum token encontrado. Exporte RAILWAY_API_TOKEN (token de CONTA, para criar projeto):
       export RAILWAY_API_TOKEN=\"...\"   # https://railway.com/account/tokens"
fi

# Confirma que o CLI consegue falar com o Railway (egress + token válidos).
log "Verificando autenticação (railway whoami)..."
if ! railway whoami 2>/tmp/railway_whoami.err; then
  cat /tmp/railway_whoami.err >&2 || true
  die "Não foi possível autenticar/conectar ao Railway.
       - Se aparecer 403/timeout: o egress do ambiente ainda bloqueia o Railway.
       - Se aparecer erro de token: use um token de CONTA (RAILWAY_API_TOKEN)."
fi

WS_FLAG=()
[ -n "${WORKSPACE:-}" ] && WS_FLAG=(--workspace "$WORKSPACE")

# ---------------------------------------------------------------------------
# 1. Projeto (idempotente: pula se o diretório já estiver linkado)
# ---------------------------------------------------------------------------
if railway status >/dev/null 2>&1; then
  log "Projeto já vinculado a este diretório — pulando 'railway init'."
else
  log "Criando o projeto '$PROJECT_NAME'..."
  railway init --name "$PROJECT_NAME" "${WS_FLAG[@]}"
fi

# ---------------------------------------------------------------------------
# 2. Deploy (cria e vincula o serviço)
# ---------------------------------------------------------------------------
log "Fazendo o deploy (railway up)... isso builda e sobe o app."
railway up --ci --yes

# ---------------------------------------------------------------------------
# 3. Volume persistente para o banco SQLite
# ---------------------------------------------------------------------------
if railway volume list 2>/dev/null | grep -q "$MOUNT_PATH"; then
  log "Volume em '$MOUNT_PATH' já existe — pulando."
else
  log "Criando volume persistente em '$MOUNT_PATH'..."
  railway volume add --mount-path "$MOUNT_PATH"
fi

# ---------------------------------------------------------------------------
# 4. Aponta o SQLite para o volume (dispara um redeploy)
# ---------------------------------------------------------------------------
log "Definindo DATABASE_PATH=$DB_PATH ..."
railway variable set "DATABASE_PATH=$DB_PATH"

# ---------------------------------------------------------------------------
# 5. Domínio público
# ---------------------------------------------------------------------------
log "Gerando domínio público..."
railway domain || warn "Não foi possível gerar o domínio automaticamente — gere em Settings → Networking."

log "Concluído! Status do projeto:"
railway status || true
cat <<EOF

Próximos passos / verificação:
  - Aguarde o redeploy terminar (railway logs).
  - Acesse https://SEU-DOMINIO.up.railway.app/health  -> {"status":"ok"}
  - Confirme que os dados persistem após um novo deploy (volume em $MOUNT_PATH).
EOF
