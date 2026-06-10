---
name: fix-ci
description:
    Fix CI failures either on the current branch or across a Graphite stack. If the user did not
    specify scope, first ask whether to fix just the current branch or the whole stack.
---

# Fix CI

Use this skill to diagnose and fix CI failures from GitHub Actions.

Start by determining the scope:

- If the user explicitly asked for the current branch only, stay on the current branch.
- If the user explicitly asked for the whole Graphite stack, use stack mode.
- If the user did not specify, ask one concise question:
  `Do you want me to fix CI on just the current branch or across the whole Graphite stack?`

This skill is intentionally conservative in both modes:

- Only make safe fixes such as formatting, lint, imports, missing imports, obvious type-only
  cleanup, CODE_STYLE conformance, and test or snapshot updates that clearly match the branch's
  intent.
- Do **not** make meaningful product or behavior changes.
- If a branch needs significant logic changes, cross-PR refactors, or a fix whose correctness is
  unclear, stop and explain the blocker to the user.

## Current branch mode

Use this mode when the user wants only the current branch fixed.

### Step 1: Identify the failing workflow run

Get the current branch name and find recent CI runs:

```bash
branch=$(git branch --show-current)
gh run list --branch "$branch" --workflow test.yaml --limit 5 --json \
  databaseId,status,conclusion,headSha,createdAt,url
```

Pick the most recent relevant failing run. If the latest run succeeded, tell the user there are no
CI failures to fix.

### Step 2: Identify which jobs failed

```bash
gh run view <run-id> --json jobs --jq '
  .jobs[] | select(.conclusion == "failure") | {name, conclusion, databaseId}
'
```

This tells you which jobs failed, such as `unit-tests` or one of the integration test categories.

### Step 3: Pull the failure logs

Prefer downloading test log artifacts:

```bash
gh run download <run-id> --name bazel_unit_testlogs --dir /tmp/ci-logs
gh run download <run-id> --name bazel_<category>_integration_testlogs --dir /tmp/ci-logs
find /tmp/ci-logs -name "test.log" -type f
```

If artifacts are unavailable, fall back to failed job logs:

```bash
gh run view <run-id> --log-failed 2>&1 | head -500
```

### Step 4: Analyze the failures

The downloaded artifacts mirror the `bazel-testlogs` directory structure. Read each `test.log` to
find the specific failure and map it back to a Bazel label.

Common failure types:

- **Type check failures** (`*_typecheck_test`)
- **Lint failures** (`*_lint_test`)
- **Format failures** (`*_format_test`)
- **Unit test failures** (`*_test`)
- **Integration test failures** (`playwright`)

### Step 5: Apply only safe fixes

Based on the logs:

1. Read the relevant source files.
2. Apply only safe non-logic fixes.
3. For formatting failures, run `dev format`.
4. If the fix would require significant logic changes, stop and tell the user why.
5. Do **not** commit changes in current-branch mode unless the user explicitly asks.

### Step 6: Verify locally

Run the narrowest verification that matches the failure:

```bash
dev check
dev test
bazel test <label> --flaky_test_attempts=1
```

Tell the user which fixes you applied and the local verification results.

### Step 7: Clean up

```bash
rm -rf /tmp/ci-logs
```

## Whole stack mode

Use this mode when the user wants CI fixed all the way up a Graphite stack.

### Start at the bottom

Always begin by understanding the shape of the current stack and then moving to its base:

```bash
gt log --stack --no-interactive
gt bottom --no-interactive
```

If `gt log --stack --no-interactive` shows there is only one PR branch remaining in the stack from
your current position, treat stack mode as a single-branch run: fix CI on that branch, wait for it
to go green, then stop instead of trying to traverse children. This includes both a true one-PR
stack and the case where you are already on the last remaining branch in a larger stack.

Keep a simple scratch list of fork branches and unvisited children. Traverse the stack depth-first:
finish one child path before returning to a fork and taking the next child.

Helpful commands:

```bash
gt children --no-interactive
gt parent --no-interactive
gt up --no-interactive
gt up --to <child-branch> --no-interactive
gt checkout <branch-name> --no-interactive
```

### Per-branch loop

For every branch you visit:

1. Read the PR metadata.
2. Stop immediately if the PR title contains `[SKIP CI]`.
3. Poll CI every 60 seconds until it passes or fails.
4. If it fails, pull the logs, make only safe fixes, stage the changed files, `gt modify`, and
   submit conservatively.
5. Repeat until the branch is green, then move upstack.

Important behavior:

- Do **not** return to the user just because checks are still pending or in progress.
- Stay inside the polling loop in the same run until the current branch is green, has a concrete
  failing run to inspect, or is blocked by something explicitly allowed by this skill such as
  `[SKIP CI]` or a required logic change.
- If GitHub is slow to populate required-check rows, treat that as `pending` and keep polling rather
  than stopping early.

Keep an ordered run log as you go. For each visited branch, record:

- branch name
- PR number and title
- whether CI was already green or required changes
- a short summary of each fix you made
- whether you stopped there because of `[SKIP CI]` or a logic-change blocker

Read the current PR title and body:

```bash
gh pr view --json number,title,body,url,headRefName,baseRefName
```

Use the PR body and diff to judge whether test or snapshot updates match the branch's goal before
changing them.

### Submission throttling

After `gt modify --no-interactive`, decide how much of the stack to submit based on the number of
remaining descendant branches above the current branch.

- If there are 2 or fewer remaining descendant branches, submit normally.
- If there are more than 2 remaining descendant branches, do **not** submit the full remainder of
  the stack yet. First submit only the current branch plus its immediate child slice.

Treat "immediate child slice" like this:

- If there are no children, submit only the current branch.
- If there is one immediate child, submit only the path through that child.
- If there are multiple immediate children, submit one path per immediate child, but do not submit
  grandchildren or deeper descendants yet.

Use `gt submit` like this:

```bash
# Current branch only
gt submit --no-interactive

# Current branch plus one immediate child path
gt submit --branch <child-branch> --no-interactive

# After the throttled slice is green, submit the rest above that child path
gt submit --branch <child-branch> --stack --no-interactive
```

For forked stacks with multiple immediate children:

- Run `gt submit --branch <child-branch> --no-interactive` once for each immediate child branch.
- Wait until the current branch and every submitted immediate child branch are green.
- Then expand each now-green child path with
  `gt submit --branch <child-branch> --stack --no-interactive`.

The reason for this throttling is to avoid spawning a large number of CI jobs before the lowermost
fixes have proved themselves. The current branch and its immediate child branch or branches may
already fix failures that would otherwise appear farther up the stack.

### CI polling

Check the current branch's required checks for its current head commit:

```bash
gh pr checks --required --json bucket,name,workflow,link --jq '
  if length == 0 then "pending"
  elif any(.[]; .bucket == "fail") then "fail"
  elif all(.[]; .bucket == "pass" or .bucket == "skipping") then "pass"
  else "pending"
  end
'
```

Interpret the result like this:

- `pass`: the branch is green, so move to the next child or go upstack.
- `pending`: wait 60 seconds, then check again.
- `fail`: inspect the failing run and fix it.

Wait with:

```bash
sleep 60
```

If checks have not started yet after `gt submit`, keep polling. Do not assume missing checks means
green. In throttled mode, do not expand to the rest of the stack until the current branch and the
submitted immediate child branch or branches are all green.

If `gh pr checks --required` does not yet show rows for a submitted branch, fall back to
`gh run list --branch <branch> --limit 20 --json ...` and inspect the newest run for the current
head commit. Treat `queued` or `in_progress` runs as `pending` and continue sleeping for 60 seconds
between polls. Only leave the polling loop once the branch is green, a failing run exists to
diagnose, or a skill-allowed blocker is confirmed.

### Pulling failing logs

After a failure, inspect runs for the current branch and commit:

```bash
branch=$(git branch --show-current)
headSha=$(git rev-parse HEAD)
gh run list --branch "$branch" --commit "$headSha" --limit 20 --json \
  databaseId,workflowName,status,conclusion,createdAt,url
```

Pick the newest failing run for the current `headSha`. Then inspect failing jobs:

```bash
gh run view <run-id> --json jobs --jq '
  .jobs[] | select(.conclusion == "failure") | {name, conclusion, databaseId}
'
```

Prefer downloading Bazel test logs when they exist:

```bash
gh run download <run-id> --name bazel_unit_testlogs --dir /tmp/ci-logs
gh run download <run-id> --name bazel_tasks_integration_testlogs --dir /tmp/ci-logs
gh run download <run-id> --name bazel_documents_integration_testlogs --dir /tmp/ci-logs
gh run download <run-id> --name bazel_forum_integration_testlogs --dir /tmp/ci-logs
gh run download <run-id> --name bazel_miscellaneous_integration_testlogs --dir /tmp/ci-logs
find /tmp/ci-logs -name "test.log" -type f
```

If artifacts are missing or expired, fall back to failed job logs:

```bash
gh run view <run-id> --log-failed 2>&1 | head -500
```

Clean up downloaded logs after finishing with a branch:

```bash
rm -rf /tmp/ci-logs
```

### Local verification

Run the narrowest local verification that matches the failure:

```bash
dev check
dev test
bazel test <label> --flaky_test_attempts=1
```

Prefer `dev check` over package-local typecheck targets when export surfaces changed. For a single
integration target, prefer `--flaky_test_attempts=1`.

### Amending and resubmitting

Stage only the files needed for the CI fix. Do not sweep in unrelated changes.

```bash
git add <file1> <file2>
gt modify --no-interactive
gt submit --no-interactive
```

After `gt submit`, return to the CI polling loop for the same branch and wait in 60-second intervals
until the new revision is green.

Do not produce a final status message while the branch is merely waiting on CI. The correct behavior
is to keep polling and continue the stack walk within the same run.

When the remainder above the current branch is large, replace the simple
`gt submit --no-interactive` flow with the throttled rollout described in **Submission throttling**.

### Moving through forks

Use `gt children --no-interactive` on every green branch.

- If there are no children, walk back down to the nearest fork with an unvisited child.
- If there is one child, use `gt up --no-interactive`.
- If there are multiple children, choose one child path, record the others in your scratch list, and
  use `gt up --to <child-branch> --no-interactive`.
- When a path finishes, return to the fork branch with `gt checkout <fork-branch> --no-interactive`
  and take the next unvisited child.

You are done only when every reachable child branch above `gt bottom` is green, unless you stop
earlier because of `[SKIP CI]` or a logic-change blocker.

### Final report

When the stack walk finishes, give the user a concise ordered summary of what happened.

- If you made no code changes at all and every visited parent branch was already green, report
  exactly: `All clear!`
- Otherwise, list branches in the order you processed them and summarize the changes needed on each
  branch.
- If you stopped early, make that explicit and say which branch caused the stop and why.

Preferred report shape:

```text
<branch-1> - already green
<branch-2> - fixed lint in ..., updated snapshot in ...
<branch-3> - fixed type-only import cleanup in ...
Stopped at <branch-4> - PR title contains [SKIP CI]
```

## Notes

- Requires `gh` CLI to be installed and authenticated.
- Stack mode also requires `gt` to be installed and authenticated.
- Artifacts have a 7-day retention period. If artifacts have expired, use `--log-failed` fallback.
- Integration test failures may be flaky. If a failure looks unrelated to branch changes, mention
  that to the user instead of forcing a risky fix.
