#!/usr/bin/env bash
# Import source-built Earth assets after validating their manifest and checksums.
set -euo pipefail
node scripts/import-earth.cjs "${HARP_SRC:-../xyz-threejs/dist/earth}"
