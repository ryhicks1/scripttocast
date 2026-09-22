#!/bin/bash
# Double-click this file in Finder to start the private casting tool.
#
# It exists because the alternative was a terminal, four commands, and a hidden
# config file — a developer's workflow for someone doing casting. Everything it
# does is what those commands did.
set -e
cd "$(dirname "$0")"

# Next.js collects anonymous usage telemetry by default. It never includes your
# documents, but this tool's whole claim is that nothing goes out, so it is off.
export NEXT_TELEMETRY_DISABLED=1

echo "Updating..."
git pull --quiet || echo "(could not update — carrying on with what is here)"

if [ ! -d node_modules ]; then
  echo "Installing dependencies, one time only..."
  npm install --no-audit --no-fund
fi

if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null; then
  echo
  echo "Ollama is not running. Open the Ollama app, then double-click this again."
  echo
  read -r -p "Press return to close."
  exit 1
fi

echo
echo "Starting. When it says Ready, open:  http://localhost:3000/private"
echo "Leave this window open while you use it. Close it to stop."
echo
npm run dev
