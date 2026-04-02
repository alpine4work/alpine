---
name: fix-ci
description:
    Fix CI failures for the current branch. Pulls the latest build logs from GitHub Actions,
    analyzes the failures, and fixes them locally. Does not commit changes.
---

# Fixing CI failures

Use this skill to diagnose and fix CI failures on the current branch by pulling logs from GitHub
Actions and applying fixes locally.

## Step 1: Identify the failing workflow run

Get the current branch name and find the latest CI run:

```bash
branch=$(git branch --show-current)
gh run list --branch "$branch" --workflow test.yaml --limit 5 --json databaseId,status,conclusion,headSha,createdAt
```

Pick the most recent run. If it succeeded, tell the user there are no CI failures to fix.

## Step 2: Identify which jobs failed

```bash
gh run view <run-id> --json jobs --jq '.jobs[] | select(.conclusion == "failure") | {name, conclusion, databaseId}'
```

This tells you which jobs failed: `unit-tests`, or one of the `integration-tests` matrix categories
(`tasks`, `documents`, `forum`, `miscellaneous`).

## Step 3: Download the failure artifacts

Failed CI runs upload Bazel test logs as artifacts. Download them:

```bash
# For unit test failures:
gh run download <run-id> --name bazel_unit_testlogs --dir /tmp/ci-logs

# For integration test failures (replace <category> with tasks, documents, forum, or miscellaneous):
gh run download <run-id> --name bazel_<category>_integration_testlogs --dir /tmp/ci-logs
```

Download all failing artifact names. If an artifact has expired or doesn't exist, fall back to
reading logs directly from the job (Step 3b).

## Step 3b: Fallback — read logs directly from the job

If artifacts aren't available, read the job logs directly:

```bash
gh run view <run-id> --log-failed 2>&1 | head -500
```

This prints the log output for failed steps. It can be verbose, so pipe through `head` initially and
read more if needed.

## Step 4: Analyze the test logs

The downloaded artifacts mirror the `bazel-testlogs` directory structure. Only failing test logs are
included (passing tests are stripped out by the CI pipeline).

Look for `test.log` files in the downloaded artifacts:

```bash
find /tmp/ci-logs -name "test.log" -type f
```

Read each `test.log` to understand the failure. The directory path encodes the Bazel label. For
example:

- `bazel-testlogs/shared/helpers/array/queue_test/test.log` → label `//shared/helpers:array/queue_test`
- `bazel-testlogs/shared/id/id_test/test.log` → label `//shared/id:id_test`

Common failure types:
- **Type check failures** (`*_typecheck_test`): TypeScript compilation errors. Read the log to find
  the file and line number.
- **Lint failures** (`*_lint_test`): ESLint errors. Read the log to find the rule and location.
- **Format failures** (`*_format_test`): Prettier formatting issues. Run `dev format` to fix.
- **Unit test failures** (`*_test`): Jest test failures. Read the log for the failing assertion.
- **Integration test failures** (tagged `playwright`): Playwright test failures. Read the log and
  check for `test.outputs` directories which may contain screenshots or traces.

## Step 5: Fix the failures

Based on the analysis:

1. **Read the relevant source files** to understand the code around each failure.
2. **Apply fixes** directly to the source files.
3. **For formatting failures**, just run `dev format`.
4. **Do not commit changes.** The user will review and commit themselves.

## Step 6: Verify fixes locally

Run the appropriate local checks to verify your fixes:

```bash
# For type check and lint failures:
dev check

# For unit test failures (runs only tests affected by your changes):
dev test

# For a specific test:
bazel test //shared/helpers:array/queue_test --flaky_test_attempts=1
```

Tell the user which fixes you applied and the results of local verification.

## Notes

- Requires `gh` CLI to be installed and authenticated (`gh auth login`).
- Artifacts have a 7-day retention period. If artifacts have expired, use `--log-failed` fallback.
- Integration test failures may be flaky. If a test failure looks unrelated to branch changes,
  mention this to the user.
- Clean up downloaded logs when done: `rm -rf /tmp/ci-logs`.
