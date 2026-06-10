---
name: graphite
description:
    Navigate and manage Graphite (gt) stacked PRs. Use when the user asks to go up/down in a stack,
    apply changes to a specific PR in the stack, submit PRs, sync, restack, or any gt-related
    workflow.
---

# Graphite (gt) Stacked PRs

Use this skill for any Graphite CLI operations — navigating stacks, applying changes to specific
PRs, submitting, syncing, and restacking.

## Terminology

- **Stack**: A sequence of PRs, each branching off its parent. e.g. `main <- A <- B <- C <- D`
- **Trunk**: The base branch stacks merge into (usually `main`).
- **Downstack**: PRs below the current one (ancestors, toward trunk).
- **Upstack**: PRs above the current one (descendants, away from trunk).

## User language mapping

| User says                          | Meaning                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| "go up" / "go up in the stack"     | `gt up` — move to the child branch                              |
| "go down" / "go down in the stack" | `gt down` — move to the parent branch                           |
| "go to the top"                    | `gt top` — move to the tip of the stack                         |
| "go to the bottom"                 | `gt bottom` — move to the branch closest to trunk               |
| "apply X to the Nth PR"            | Navigate to the Nth branch off trunk and apply the change there |
| "submit" / "push"                  | `gt submit` or `gt submit --stack`                              |
| "sync"                             | `gt sync`                                                       |
| "restack"                          | `gt restack`                                                    |
| "create a new PR on top"           | `gt create`                                                     |
| "modify this PR"                   | `gt modify`                                                     |
| "absorb" / "absorb changes"        | `gt absorb --force`                                             |

## Counting PRs in a stack

When the user refers to "the Nth PR", count from trunk (1-indexed, excluding trunk itself):

```
main → A → B → C → D
        1    2    3    4
```

"Third PR" = branch C. "First PR" = branch A (the one directly on top of main).

## Navigation

```bash
# See the current stack
gt log

# Move up/down
gt up           # one branch toward tip
gt up 3         # three branches toward tip
gt down         # one branch toward trunk
gt down 2       # two branches toward trunk

# Jump to extremes
gt top          # tip of stack
gt bottom       # closest to trunk

# Checkout a specific branch
gt checkout <branch-name>
```

## Applying changes to a specific PR

When the user asks to apply a change to a specific PR in the stack:

1. Run `gt log` to see the full stack and identify the target branch.
2. Count branches from trunk to find the Nth PR.
3. Run `gt checkout <branch-name>` to switch to that branch.
4. Read the relevant files and apply the requested change.
5. Run `gt modify` to amend the change into the current branch's commit and restack descendants.
6. Navigate back to the original branch if the user was working elsewhere.

## Core workflow commands

```bash
# Create a new branch stacked on current branch with staged changes
gt create <branch-name>

# Amend current branch and restack descendants
gt modify

# Submit current branch + downstack to GitHub as PRs
gt submit

# Submit entire stack
gt submit --stack

# Sync trunk, rebase all stacks, clean up merged branches
gt sync

# Rebase every branch in the stack to have latest changes
gt restack

# Merge the stack via Graphite
gt merge
```

## Absorbing changes into the right commit

`gt absorb` amends staged changes into the correct commits in the current stack automatically. It
inspects each staged hunk and finds the first downstack commit where that hunk applies
deterministically. Hunks that don't match a single commit are skipped.

```bash
# Absorb staged changes (non-interactive, no confirmation prompt)
gt absorb --force

# Stage all unstaged changes and absorb (does NOT include untracked files)
gt absorb --force --all

# Preview which commits would receive each hunk without applying
gt absorb --dry-run
```

- Use `--force` (or `-f`) to skip the confirmation prompt — required for non-interactive use.
- Use `--all` (or `-a`) to auto-stage tracked, unstaged changes before absorbing. New (untracked)
  files are never absorbed since file creations can't match an existing commit.
- Use `--dry-run` (or `-d`) to preview the plan without modifying anything.
- After absorbing, gt automatically restacks branches upstack of the current branch.

**When to use absorb autonomously vs. prompting the user:**

Only use `gt absorb --force` when you are very confident the changes will land in the correct
commits. Always run `gt absorb --dry-run` first and verify the output makes sense before applying.
If any of the following are true, do NOT absorb automatically — instead show the dry-run output and
ask the user to confirm:

- The dry-run shows hunks being skipped (no clear target commit).
- The changeset is large (many files or hunks across multiple commits).
- You are unsure which commit a change belongs to.

This is especially useful when making fixes that span multiple PRs in a stack — stage all the
changes and let `gt absorb` route each hunk to the right commit instead of manually checking out
each branch.

## Other useful commands

```bash
# See info about current branch
gt info

# Rename current branch
gt rename <new-name>

# Delete a branch (restacks children onto parent)
gt delete <branch-name>

# Fold current branch into its parent
gt fold

# Split current branch into multiple branches
gt split

# Squash all commits in current branch into one
gt squash

# Undo last gt operation
gt undo

# Open PR page in browser
gt pr
```

## Restacking (resolving conflicts)

When branches in a stack need rebasing (e.g. after modifying a branch mid-stack or after syncing
trunk), use `gt restack`. If conflicts arise, resolve them in a loop:

```bash
# Start the restack
gt restack

# For each conflict:
# 1. Resolve the conflicts in the affected files
# 2. Stage all changes
git add -A
# 3. Continue the restack
gt continue

# Repeat steps 1-3 until the restack completes.
```

- `gt restack` rebases every branch in the stack so each has its parent in its history.
- If you want to bail out of a conflicted restack, use `gt abort`.

## Non-interactive mode

When running gt commands from Claude, prefer non-interactive mode to avoid prompts:

```bash
gt <command> --no-interactive
```

## Notes

- Always run `gt log` first to understand the current stack before navigating.
- After modifying a branch mid-stack, gt automatically restacks descendants.
- If a rebase conflict occurs during restack, see the "Restacking" section above.
- Prefer `gt modify` over raw git commands when amending a branch in a stack — it handles
  restacking.
- Use `gt sync` at the start of a session to ensure branches are up to date with remote.
