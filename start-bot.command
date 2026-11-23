#!/bin/sh
# Double-click to run the bot on a Mac without Docker (docs/WITHOUT-DOCKER.md).
# The first run installs and sets everything up and asks for your bot token.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org, then run this again."
  exit 1
fi
exec node scripts/local.cjs start
