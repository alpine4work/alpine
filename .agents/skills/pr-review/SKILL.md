---
name: pr-review
description: |
    Run a multi-agent PR review. Fans out to specialized review agents (general, history, security,
    compatibility) that write individual reports, then combines them into a single review.md.
---

# PR Review

Run a parallel, multi-agent review of the current branch's diff against its Graphite parent branch.

## Step 1: Determine the parent branch

Use Graphite to find the parent branch:

```bash
# Returns just the parent branch name (e.g. "main")
gt parent
```

If Graphite is not available, fall back to `main`.

## Step 2: Determine the branch name and create the output directory

```bash
BRANCH=$(git branch --show-current)
```

Create the output directory at `admin/docs/agents/review/{branch-name}/`. Use `mkdir -p`.

## Step 3: Fan out to review agents

Dispatch all four review agents **in parallel** using the Agent tool. Each agent should be given:

- The parent branch name to diff against
- The output file path to write its findings to

Launch these four agents simultaneously:

1. **review-general** agent — write to `admin/docs/agents/review/{branch-name}/general.md`
    - Prompt: "Review the diff of the current branch against `{parent-branch}`. Write your findings
      to `admin/docs/agents/review/{branch-name}/general.md`."

2. **review-history** agent — write to `admin/docs/agents/review/{branch-name}/history.md`
    - Prompt: "Review the history and patterns of files changed in the current branch compared to
      `{parent-branch}`. Write your findings to
      `admin/docs/agents/review/{branch-name}/history.md`."

3. **review-security** agent — write to `admin/docs/agents/review/{branch-name}/security.md`
    - Prompt: "Perform a security review of the diff between the current branch and
      `{parent-branch}`. Write your findings to
      `admin/docs/agents/review/{branch-name}/security.md`."

4. **review-compatibility** agent — write to
   `admin/docs/agents/review/{branch-name}/compatibility.md`
    - Prompt: "Review the diff between the current branch and `{parent-branch}` for backwards
      compatibility issues with old clients. Write your findings to
      `admin/docs/agents/review/{branch-name}/compatibility.md`."

## Step 4: Combine into final review

After all four agents complete, read all four output files:

- `admin/docs/agents/review/{branch-name}/general.md`
- `admin/docs/agents/review/{branch-name}/history.md`
- `admin/docs/agents/review/{branch-name}/security.md`
- `admin/docs/agents/review/{branch-name}/compatibility.md`

Combine them into a single `admin/docs/agents/review/{branch-name}/review.md` with this format:

```markdown
# PR Review: {branch-name}

## General Feedback

{Paste the Summary section from general.md}

---

## Bugs

{Paste the Bugs section from general.md. If empty, "No issues found."}

## Performance Issues

{Paste the Performance Issues section from general.md. If empty, "No issues found."}

## Code Style

{Paste the Code Style section from general.md. If empty, "No issues found."}

---

## Historical Patterns

{Paste all findings from history.md, preserving section structure}

---

## Security

{Paste all findings from security.md, preserving section structure}

---

## Backwards Compatibility

{Paste all findings from compatibility.md, preserving section structure}
```

Ensure all `### [ ]` checkbox items are preserved so the author can check them off as they address
each finding. Remove any duplicate findings that appear in multiple reports — keep the most detailed
version.

## Step 5: Output the new path

Finally, give the user the path to the final review file at
`admin/docs/agents/review/{branch-name}/review.md`
