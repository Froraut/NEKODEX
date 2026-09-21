#!/bin/sh
set -eu

# Retained as a fail-closed entry point for old checkout instructions. A checksum downloaded
# beside an archive does not authenticate its publisher, and the downloaded runtime cannot
# safely be used to verify itself. Do not fetch, extract, execute, or replace anything here.
cat >&2 <<'MESSAGE'
The terminal-only runtime installer has been retired because it cannot authenticate downloads.
Install NEKODEX using the signed desktop application from:
  https://github.com/Froraut/NEKODEX/releases
Existing desktop installations can use the built-in updater, which verifies signed metadata.
For terminal development, use a reviewed source checkout and its documented Bun setup:
  https://github.com/Froraut/NEKODEX#develop
MESSAGE
exit 1
