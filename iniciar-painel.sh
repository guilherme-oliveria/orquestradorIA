#!/usr/bin/env bash
# Sobe o painel do Orquestrador IA no WSL (ou em qualquer Linux/macOS).
# Uso: bash iniciar-painel.sh            (porta padrão 47621; ORQ_PORT e ORQ_DATA_DIR continuam valendo)
set -euo pipefail
cd "$(dirname "$0")"

# Node pode vir do nvm, que só entra no PATH de shells interativos.
if ! command -v node >/dev/null 2>&1 && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Instale o Node.js 24 ou superior (ex.: nvm install 24) antes de iniciar o painel." >&2
  exit 1
fi
versao=$(node -p 'process.versions.node.split(".")[0]')
if [ "$versao" -lt 24 ]; then
  echo "O painel precisa do Node.js 24 ou superior; encontrado $(node --version)." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Aviso: GitHub CLI (gh) não encontrado neste ambiente. O painel não vai conseguir ler PRs." >&2
elif ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Aviso: gh sem login. Rode: gh auth login --hostname github.com --web" >&2
fi

echo "Node $(node --version) · porta ${ORQ_PORT:-47621} · dados em ${ORQ_DATA_DIR:-$PWD/data}"
exec node server.mjs
