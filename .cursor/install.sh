#!/bin/bash

set -euo pipefail

workspace_path=$(cd "$(dirname "$0")/.." && pwd)

for file in "$workspace_path/admin/bin"/*; do
    ln -sf "$file" /usr/local/bin/
done
