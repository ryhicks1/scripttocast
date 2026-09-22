#!/bin/bash
# Double-click this file in Finder to start the private casting tool.
#
# It is also the update path. Someone running this on their own Mac is never
# going to run git, so the launcher does it: every launch pulls the latest
# version, installs anything new it needs, and downloads a new AI model if the
# recommended one has changed. That is why it reports what it did rather than
# doing it silently — an update that arrives without a word is one nobody trusts.
set -e
cd "$(dirname "$0")"

# Next.js collects anonymous usage telemetry by default. It never includes your
# documents, but this tool's whole claim is that nothing goes out, so it is off.
export NEXT_TELEMETRY_DISABLED=1

echo "Checking for updates..."
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "none")
git pull --quiet 2>/dev/null || echo "  Couldn't check — carrying on with the version you have."
AFTER=$(git rev-parse HEAD 2>/dev/null || echo "none")

if [ "$BEFORE" != "$AFTER" ]; then
  echo "  Updated to the latest version."
else
  echo "  You're up to date."
fi

# Always, not just when node_modules is missing: an update that adds a new
# dependency would otherwise start and then fail with an error nobody can read.
echo "Checking the app has everything it needs..."
npm install --no-audit --no-fund --silent

if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null; then
  echo
  echo "Ollama isn't running. Open the Ollama app from your Applications folder,"
  echo "wait for the llama to appear in the menu bar, then double-click this again."
  echo
  read -r -p "Press return to close."
  exit 1
fi

# The recommended model lives in recommended-model.json so that changing it
# there reaches every user through this check.
WANTED=$(node -p "require('./recommended-model.json').model" 2>/dev/null || echo "")
SIZE_GB=$(node -p "require('./recommended-model.json').approxMemoryGb" 2>/dev/null || echo "6")

# Exact match on the model name, including its tag. Matching the family alone
# would count llama3.1:8b as satisfying a future recommendation of llama3.1:70b.
INSTALLED=$(ollama list 2>/dev/null | awk 'NR>1 {print $1}')
if [ -n "$WANTED" ] && ! echo "$INSTALLED" | grep -qx -e "$WANTED" -e "${WANTED}:latest"; then
  echo
  echo "This version uses a better AI model than the one you have: $WANTED"
  echo "It's about ${SIZE_GB}GB and downloads once. Without it, descriptions come out thin."
  echo
  read -r -p "Download it now? [Y/n] " REPLY
  case "$REPLY" in
    [Nn]*) echo "  Skipped. You can do this later by double-clicking here again." ;;
    *)
      echo "  Downloading — this takes a few minutes. Leave it alone."
      ollama pull "$WANTED"
      echo "  Done."
      ;;
  esac
fi

echo
echo "Starting. When it says Ready, open:  http://localhost:3000/private"
echo "Leave this window open while you use it. Close it to stop."
echo
npm run dev
