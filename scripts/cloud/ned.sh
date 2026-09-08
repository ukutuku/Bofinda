#!/usr/bin/env bash
# Stopper alt, dette miljø selv startede. Data bliver liggende.
set -euo pipefail
cd "$(dirname "$0")/../.."
./scripts/cloud/app-ned.sh
./scripts/cloud/db-ned.sh
