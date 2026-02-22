#!/bin/bash

# NOCOMMIT: I use this for quickly iterating with AI while giving me undo
# history. We'll delete this script before merging into the codebase proper.

# Commit with a message that's the ISO 8601 date and time. Makes it easy to
# quickly commit agent changes without thinking of a message.

# No-op if there are no changes
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

git add .
git commit -m "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
