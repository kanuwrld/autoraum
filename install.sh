#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  echo 'Usage: bash install.sh [INSTALL_DIRECTORY] [--port NUMBER] [--enable-public-search]'
  echo 'Requires Node.js 24+, npm and Git. Defaults to ~/autoraum. No sudo or account needed.'
  exit 0
fi
for executable in node npm git; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "Missing $executable. Install Node.js 24+ (https://nodejs.org) and Git, then retry." >&2
    exit 1
  fi
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24+ is required"); process.exit(1); }'

install_directory="${1:-$HOME/autoraum}"
if [[ $# -gt 0 ]]; then shift; fi
repository='https://github.com/kanuwrld/autoraum.git'
if [[ -d "$install_directory/.git" ]]; then
  existing_remote="$(git -C "$install_directory" remote get-url origin)"
  if [[ "$existing_remote" != "$repository" && "$existing_remote" != "https://github.com/kanuwrld/autoraum" ]]; then
    echo 'Destination belongs to a different repository. Choose a new directory.' >&2
    exit 1
  fi
  echo 'Using the existing installation; no files or Git history will be replaced.'
elif [[ -e "$install_directory" ]]; then
  echo 'Destination already exists. Choose a new directory; nothing was overwritten.' >&2
  exit 1
else
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= clone --depth 1 -- "$repository" "$install_directory"
fi
cd -- "$install_directory"
if [[ ! -f scripts/local.ts ]]; then
  echo 'This installation predates the launcher. Update it with git pull --ff-only first.' >&2
  exit 1
fi
exec npm run local -- "$@"
