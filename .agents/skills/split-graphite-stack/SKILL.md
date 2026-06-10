---
name: split-graphite-stack
description: |
    Split the current branch into multiple PRs in a Graphite stack. Use when the user wants to
    turn one branch into a smaller stacked series of PRs, confirm the proposed split first, then
    rewrite the branch and submit the stack.
---

# Split a branch into a Graphite stack

Use this skill when the user wants to break the current branch into a smaller Graphite stack of
reviewable PRs.

Also read `.agents/skills/graphite/SKILL.md` if you need a refresher on Graphite commands or
restack conflict handling.

## Goal

Create a bottom-up PR plan that favors:

- implemented, reviewable pieces of work
- isolated features or cohesive behavior changes, not frontend/backend buckets
- a shorter stack with larger, still-shippable pieces
- stack boundaries that will not be painful to restack if an earlier PR changes

Do not force a split that is too interleaved to be safe. If the code only supports a larger split,
say so and propose fewer PRs.

## Step 1: Preconditions

Before proposing anything:

1. Confirm you are not on trunk:

    ```bash
    branch=$(git branch --show-current)
    ```

    If `branch` is `main` or another trunk branch, stop and tell the user.

2. Require a clean working tree:

    ```bash
    git status --short
    ```

    If there are local edits, ask the user to clean them up or explicitly tell you how to handle
    them before you rewrite history.

3. Determine the Graphite parent:

    ```bash
    parent=$(gt parent)
    ```

    If `gt parent` fails, stop and ask the user how they want to proceed. This skill is for an
    existing Graphite branch.

4. Inspect whether the current branch already has Graphite children:

    ```bash
    gt log short
    ```

    Record the names of any branches that are direct children of the current branch. You will need
    to reparent those existing children onto the last branch of the new stack later.

## Step 2: Analyze the branch

Collect the stack and diff context before proposing PRs:

```bash
gt log
git log --oneline "$parent"..HEAD
git diff --stat "$parent"...HEAD
git diff --name-only "$parent"...HEAD
git diff "$parent"...HEAD
```

Then read the changed files and group the work semantically.

Bias the proposal toward slices that are already implemented and can stand on their own. A good
stack often looks like:

- stable prerequisite or refactor that later PRs depend on
- one cohesive feature slice
- another cohesive feature slice
- polish, follow-up wiring, or tests that only make sense after the earlier slices

Do not split just by directory or layer. If a single user-visible feature touches server and client,
it can still be one PR.

For each candidate PR, think about:

- what behavior becomes reviewable in that PR
- which files or hunks belong together
- what later PRs would have to restack if this PR changes substantially
- whether the slice is too coupled to ship independently
- whether combining adjacent slices would produce a sturdier, shorter stack

## Step 3: Proposal loop

Do not rewrite the branch yet.

Present a proposed stack **from trunk upward**. For each PR include:

- branch name
- PR title
- 1-2 sentence goal
- key files or areas included
- dependency note explaining why it belongs at that height in the stack
- note if you intentionally combined related work to keep the stack shorter
- intended test plan

Then explicitly ask the user to confirm or change the stack.

If the current branch already has children, also tell the user that those children will be
reparented onto the last newly created branch so the rest of the existing stack stays attached above
the rewritten work.

Stay in the proposal loop until the user clearly agrees or gives a different direction. Revise the
plan as many times as needed. Do not start stacking on a partial or implied approval.

## Step 4: Create a safety snapshot

Once the user approves the plan, create a temporary branch at the current tip so you can compare the
final stack against the original branch later:

```bash
branch=$(git branch --show-current)
snapshotBranch="temp/${branch//\//-}-stack-snapshot-$(date +%Y%m%d%H%M%S)"
git branch "$snapshotBranch" HEAD
```

Tell the user which snapshot branch you created.

## Step 5: Rewrite the original branch into PR 1

The current branch becomes the first PR in the stack unless the user explicitly wants a rename.

Reset the branch to its parent while leaving the full branch diff available in the working tree:

```bash
git reset --soft "$parent"
git reset
```

Now stage only the first PR:

- use `git add <paths>` when the split is clean by file
- use `git add -p <path>` when a file needs hunk-level separation

Avoid broad staging flags like `-A` here unless the entire remaining diff belongs to PR 1.

If later slices still remain, stash them while keeping the staged first PR in place:

```bash
git stash push --keep-index --include-untracked --message "stack split leftovers after pr1"
```

Commit the first PR onto the original branch:

```bash
gt modify --message "<pr-1 title>" --no-interactive
```

Run the agreed tests for PR 1. Minimum expectation:

- `dev check`
- targeted `bazel test ...` or `dev test` for touched behavior

Do not move on until the tests pass or the user explicitly accepts a known failure.

If you stashed later changes, restore them after PR 1 is green:

```bash
git stash pop
```

## Step 6: Build each later PR from the remaining diff

For PR 2 and onward, repeat this loop in order:

1. Stage only the next approved slice from the remaining diff.
2. If more later slices still remain after this one, stash them while keeping the staged slice:

    ```bash
    git stash push --keep-index --include-untracked --message "stack split leftovers"
    ```

3. Create the next Graphite branch with that slice:

    ```bash
    gt create <branch-name> --message "<pr title>" --no-interactive
    ```

4. Run the agreed tests for that PR.
5. If you stashed later changes, restore them:

    ```bash
    git stash pop
    ```

6. Continue to the next PR.

If a split boundary maps cleanly to files, `gt split --by-file ...` can help. Prefer manual staging
when the real boundary is semantic or hunk-based.

If Graphite needs to restack and conflicts appear, resolve them and continue with the normal Graphite
flow:

```bash
git add -A
gt continue
```

If the conflicts reveal the plan was too fragile, pause and ask the user whether to regroup the
remaining slices into fewer PRs.

## Step 7: Reparent any pre-existing children onto the new top branch

If the original branch had direct children before you started splitting, move each of those
children so their new parent is the last branch you created in this stack.

For each original child branch:

```bash
gt move --source <child-branch> --onto <last-new-branch> --no-interactive
```

After reparenting them, inspect the result:

```bash
gt log short
```

If a move triggers conflicts during restack, resolve them before continuing. If the conflicts show
that one of the rewritten branches needs to absorb extra prerequisite work, pause and regroup with
the user instead of forcing the old child stack through a bad parent boundary.

## Step 8: Validate the finished stack

After the last PR is created, verify that the tip of the new stack matches the original branch
snapshot.

First inspect the stack:

```bash
gt log
```

Then compare the tip to the snapshot branch:

```bash
git diff --stat "$snapshotBranch" HEAD
test "$(git rev-parse "$snapshotBranch^{tree}")" = "$(git rev-parse "HEAD^{tree}")"
```

If the trees differ, stop and fix the missing or extra changes before submitting anything.

Also confirm in `gt log` that any pre-existing child branches now hang off the last newly created
branch, not the first branch in the rewritten stack.

## Step 9: Submit only after user confirmation

When the stack is complete and validated, ask the user if they are ready to submit it.

Only after a clear yes, run:

```bash
gt submit --no-interactive
```

Because you finish on the tip branch, this submits the whole downstack.

## Step 10: Generate and apply PR descriptions for the full stack

After submit succeeds, run the `pr-description` skill workflow on **each branch created in this
stack** and update every submitted PR body.

Before iterating through the new branches, check whether the original branch already had a PR
description. If it did, use that description as reviewer-facing context while drafting the new PR
descriptions.

For example:

```bash
gh pr view <original-branch-name> --json body --jq .body
```

If the original PR body exists, pull forward only the parts that are still relevant after the split,
such as:

- high-level motivation
- rollout or reviewer context
- non-obvious reasoning
- useful testing notes

Do not copy over stale claims that now belong only to a different PR in the new stack, and do not
repeat the same explanation verbatim in every PR unless it is genuinely needed in each one.

Work branch-by-branch from trunk upward using the approved PR list you created earlier.

For each branch:

1. Check out the branch:

    ```bash
    gt checkout <branch-name>
    ```

2. Follow the `pr-description` skill:
   - determine the branch parent with `gt parent`
   - inspect `git diff <parent>...HEAD`
   - inspect `git log <parent>..HEAD --oneline`
   - optionally inspect `gt log short`
   - if the original unsplit branch had a PR description, incorporate the relevant parts of that
     description into this branch's new description
   - write the description in the required `TL;DR` / `What changed?` / optional
     `Further reading` format

3. Show the generated description to the user.

4. Copy it to the clipboard, since that is part of the `pr-description` workflow:

    ```bash
    cat <<'EOF' | pbcopy
    <pr-description>
    EOF
    ```

5. Update the actual PR body for that branch:

    ```bash
    cat <<'EOF' | gh pr edit <branch-name> --body-file -
    <pr-description>
    EOF
    ```

6. Tell the user which branch's PR body you updated, then continue to the next branch.

When you finish, return to the tip branch unless the user asks you to stay elsewhere.

## Notes

- Keep the user updated as you move from proposal, to rewrite, to testing, to validation.
- Prefer fewer, sturdier, larger shippable PRs over aggressively splitting into many tiny ones.
- If you discover a slice needs major changes before it can stand on its own, tell the user and
  propose a different stack instead of forcing it.
