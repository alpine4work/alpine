---
name: pr-review
description: |
    Run a multi-agent PR review. Fans out to specialized review agents (general, history, security,
    compatibility, performance) that write individual reports, then combines them into a single
    review.md.
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

Before dispatching, resolve the five custom subagents by name using the current agent runner's
native custom-agent mechanism. This skill is runner-agnostic:

- In Claude Code, these are expected to resolve from `.claude/agents/{agent-name}.md`.
- In Codex, these are expected to resolve from `.codex/agents/{agent-name}.toml`.

Do a quick preflight before launching:

1. Verify that all five required agent names are available to the current runner:
   `review-general`, `review-history`, `review-security`, `review-compatibility`, and
   `review-performance`.
2. If the runner exposes agent config files, inspect or list them to confirm the named agents are
   the project-local review agents, not generic built-ins with coincidentally similar names.
3. If any agent is missing, stop and report the missing agent name(s) instead of silently
   substituting a generic agent or doing the review in the main agent.

Dispatch all five resolved custom subagents **in parallel**. Each subagent should be given:
- The parent branch name to diff against
- The output file path to write its findings to

Launch these five custom subagents simultaneously:

1. **review-general** custom subagent — write to `admin/docs/agents/review/{branch-name}/general.md`
   - Prompt: "Review the diff of the current branch against `{parent-branch}`. Write your findings to `admin/docs/agents/review/{branch-name}/general.md`."

2. **review-history** custom subagent — write to `admin/docs/agents/review/{branch-name}/history.md`
   - Prompt: "Review the history and patterns of files changed in the current branch compared to `{parent-branch}`. Write your findings to `admin/docs/agents/review/{branch-name}/history.md`."

3. **review-security** custom subagent — write to `admin/docs/agents/review/{branch-name}/security.md`
   - Prompt: "Perform a security review of the diff between the current branch and `{parent-branch}`. Write your findings to `admin/docs/agents/review/{branch-name}/security.md`."

4. **review-compatibility** custom subagent — write to `admin/docs/agents/review/{branch-name}/compatibility.md`
   - Prompt: "Review the diff between the current branch and `{parent-branch}` for backwards compatibility issues with old clients. Write your findings to `admin/docs/agents/review/{branch-name}/compatibility.md`."

5. **review-performance** custom subagent — write to `admin/docs/agents/review/{branch-name}/performance.md`
   - Prompt: "Perform a performance-only review of the diff between the current branch and `{parent-branch}`. Write your findings to `admin/docs/agents/review/{branch-name}/performance.md`."

## Step 4: Combine into final review

After all five agents complete, read all five output files:

- `admin/docs/agents/review/{branch-name}/general.md`
- `admin/docs/agents/review/{branch-name}/history.md`
- `admin/docs/agents/review/{branch-name}/security.md`
- `admin/docs/agents/review/{branch-name}/compatibility.md`
- `admin/docs/agents/review/{branch-name}/performance.md`

Combine them into a single `admin/docs/agents/review/{branch-name}/review.md` with this format:

```markdown
# PR Review: {branch-name}

## General Feedback

{Paste the Summary section from general.md}

---

## Bugs

{Paste the Bugs section from general.md. If empty, "No issues found."}

## Performance Issues

{Paste all findings from performance.md, preserving section structure. If empty, "No issues found."}

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
version. If the same performance issue appears in both `general.md` and `performance.md`, keep the
`performance.md` version.

## Step 5: Output the new path

Finally, give the user the path to the final review file at 
`admin/docs/agents/review/{branch-name}/review.md`
