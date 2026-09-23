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

# Ollama must answer one request at a time. With several request slots it
# can keep the script it has read in one slot and answer the next role from
# another, re-reading the whole screenplay each time — the difference between
# a run of minutes and a run of an hour. The menu-bar app ignores settings
# typed into a terminal, so the setting is given to macOS and the app is
# restarted to pick it up. Nobody should have to do this by hand.
launchctl setenv OLLAMA_NUM_PARALLEL 1
# Flash attention and an 8-bit key/value cache are what make a whole feature
# script workable on a laptop: every word written attends over the entire
# script, and these make that faster and halve the memory it holds.
launchctl setenv OLLAMA_FLASH_ATTENTION 1
launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0
# Bumped whenever the settings above change, so Ollama is restarted once to
# take them — the menu-bar app only reads them when it starts.
SETTINGS_VERSION=2
if [ "$(launchctl getenv OLLAMA_NUM_PARALLEL_APPLIED 2>/dev/null)" != "$SETTINGS_VERSION" ] \
   && curl -sf http://127.0.0.1:11434/api/tags > /dev/null; then
  echo "Restarting Ollama with the right settings..."
  osascript -e 'quit app "Ollama"' 2>/dev/null || true
  pkill -x ollama 2>/dev/null || true
  sleep 2
fi
launchctl setenv OLLAMA_NUM_PARALLEL_APPLIED "$SETTINGS_VERSION"

if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null; then
  echo "Starting Ollama..."
  open -a Ollama 2>/dev/null || (OLLAMA_NUM_PARALLEL=1 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 nohup ollama serve > /dev/null 2>&1 &)
  for _ in $(seq 1 30); do
    curl -sf http://127.0.0.1:11434/api/tags > /dev/null && break
    sleep 1
  done
fi

if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null; then
  echo
  echo "Ollama didn't start. Open the Ollama app from your Applications folder,"
  echo "wait for the llama to appear in the menu bar, then double-click this again."
  echo
  read -r -p "Press return to close."
  exit 1
fi

# An old copy of the tool still running keeps serving old code, and a second
# copy refuses to start. Stop the old one so this launch is the version pulled
# above — otherwise a fix can be downloaded and never actually run.
if lsof -ti tcp:3000 > /dev/null 2>&1; then
  echo "Stopping the copy of the tool that was already running..."
  lsof -ti tcp:3000 | xargs kill 2>/dev/null || true
  sleep 2
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

# Open the tool as soon as it answers, rather than leaving someone to type a
# URL into a browser every time they want to use it. Bounded, so a server that
# never starts does not leave a loop running.
(
  for _ in $(seq 1 120); do
    if curl -sf http://localhost:3000/private > /dev/null 2>&1; then
      open http://localhost:3000/private
      exit 0
    fi
    sleep 1
  done
) &

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
echo
echo "Version $VERSION ($BRANCH)."
echo "Starting. Your browser will open by itself in a moment."
echo "If it doesn't, go to:  http://localhost:3000/private"
echo
echo "Leave this window open while you use it. Close it to stop."
echo
npm run dev
