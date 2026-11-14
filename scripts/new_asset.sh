#!/bin/sh
# Create a rigged-asset project from the skill template and install its npm dependencies.
# Usage: new_asset.sh <target-dir>
set -eu
[ $# -ge 1 ] || { echo "usage: $0 <target-dir>" >&2; exit 2; }
skill=$(cd "$(dirname "$0")/.." && pwd)
target=$1
if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "refusing to overwrite non-empty $target" >&2
  exit 1
fi
mkdir -p "$target"
cp -R "$skill/assets/template/." "$target/"
printf 'node_modules/\nout/\n' > "$target/.gitignore"
cd "$target"
npm install --no-audit --no-fund --loglevel=error
echo "created $(pwd)"
echo "next: edit src/creature.js, then npm start (preview) / npm run pipeline"
