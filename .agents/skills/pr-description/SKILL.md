---
name: pr-description
description: |
    Generate a PR description for the current branch. Use when the user asks to write, generate, or
    create a PR description, or when they want to describe what changed in their branch for a pull
    request.
---

# PR Description Generator

Use this skill to generate a well-structured PR description for the current branch. The description
is compared against the parent branch (determined via Graphite) and copied to the clipboard.

## Workflow

### Step 1: Identify the parent branch

```bash
# Get the parent branch name (returns just the branch name, e.g. "main")
gt parent
```

Use the output directly as the parent branch name. This is the base for the diff.

### Step 2: Gather the diff

```bash
# Diff against the parent branch
git diff <parent-branch>...HEAD

# See commit messages on this branch (these often contain useful context)
git log <parent-branch>..HEAD --oneline

# Optional: see where this branch sits in the stack for broader context
gt log short
```

If the diff is very large, focus on the most important files first. Use `git diff --stat` to get an
overview, then read the most significant changes in detail.

### Step 3: Write the PR description

Use this exact format:

```markdown
### TL;DR

<2-3 sentences summarizing what this PR does and why.>

### What changed?

- <bullet point describing a major change>
- <bullet point describing a major change>
- ...

### Further reading

<Optional explanation of concepts, themes, or reasoning behind non-obvious decisions.>
```

**Guidelines for each section:**

**TL;DR:**

- 2-3 sentences max.
- Lead with _what_ the PR does, then _why_.
- Write for a reviewer who has context on the project but hasn't seen this branch.

**What changed?:**

- 1-8 bullet points covering the major changes.
- Aim for the smaller end (3-5 bullets is ideal).
- Each bullet should describe a meaningful change, not individual file edits.
- Group related file changes into a single bullet.
- Prefer describing behavior changes over listing files touched.

**Further reading (optional):**

- Only include this section if the PR is large or involves non-obvious decisions.
- Also include if the user explicitly asks for it.
- Use this section to break down concepts, themes, or reasoning behind decisions.
- Structure as prose paragraphs or sub-sections, not just more bullet points.

### Step 4: Copy to clipboard

```bash
# Copy the generated description to the clipboard
echo '<pr-description>' | pbcopy
```

Use a heredoc if the description contains single quotes:

```bash
cat <<'EOF' | pbcopy
<pr-description>
EOF
```

Tell the user the description has been copied to their clipboard.

## Notes

- Always use Graphite (`gt`) to determine the parent branch — do not assume it's `main`.
- If `gt` is not available or the branch isn't tracked by Graphite, fall back to comparing against
  the branch's upstream or `main`.
- Do not include the `### Further reading` section unless the PR is genuinely large or complex, or
  the user asks for it.
- Show the generated description to the user before copying so they can review it.
