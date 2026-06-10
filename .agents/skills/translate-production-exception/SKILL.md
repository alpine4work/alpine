---
name: translate-production-exception
description:
    Resolve a minified production stack trace to original source locations using sourcemaps. Use
    when the user shares a production exception or stack trace.
---

# Translating a production exception

Use `dev sourcemap` to resolve minified production stack traces back to original source locations.

**1. Get the stack trace from the user.** Copy it to the clipboard, then run:

```bash
dev sourcemap
```

The command automatically reads from the clipboard if it contains a stack trace. It fetches the
currently deployed commit, downloads the sourcemap artifact from GitHub Actions, and prints the
resolved stack trace with original file paths and line numbers.

**2. If the user provides a specific commit SHA**, pass it explicitly:

```bash
dev sourcemap --commit=<sha>
```

**3. Alternatively, pipe the stack trace directly:**

```bash
echo "<stack trace>" | dev sourcemap
```

**4. Read the resolved output.** The output maps minified locations back to original source files
and line numbers. Read those source files to understand the code at the referenced locations, then
help the user understand what went wrong and why the error occurred.

## Notes

- Requires `gh` CLI to be installed and authenticated (`gh auth login`).
- Sourcemaps are stored as GitHub Actions artifacts with 3-day retention.
- If the exact commit's artifact is missing, the tool tries up to 4 parent commits.
- Sourcemaps are cached locally so subsequent lookups for the same commit are instant.
