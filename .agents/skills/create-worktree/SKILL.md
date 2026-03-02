---
name: create-worktree
description:
    Create a git worktree for isolated development with its own dev server, database, and session.
    Use when the user asks to create a new workspace or isolated environment.
---

# Creating a worktree for isolated development

Use git worktrees to work in an isolated environment with its own dev server, database, and session.
If a user asks you to create a new workspace, look in the parent directory to see which worktree
indexes already exist.

**1. Create the worktree and branch:**

```bash
git worktree add ../cyberworlds-worktree-1 -b <branch-name>
cd ../cyberworlds-worktree-1
```

**2. Create `.env.development.local` with unique ports (add 100 for worktree-1, 200 for worktree-2,
etc.):**

```bash
DEV_ENV_PATHS_NAME_SUFFIX=-worktree-1
EDGE_DEV_PORT=3100
EDGE_DEV_INSPECTOR_PORT=3101
APP_DEV_PORT=3110
APP_DEV_INSPECTOR_PORT=3111
TASK_REALTIME_DEV_PORT=3120
TASK_REALTIME_DEV_INSPECTOR_PORT=3121
JOB_QUEUE_DEV_INSPECTOR_PORT=3131
FILE_PROCESSOR_DEV_PORT=3140
FILE_PROCESSOR_DEV_INSPECTOR_PORT=3141
API_DEV_PORT=3150
API_DEV_INSPECTOR_PORT=3151
AGENTS_DEV_PORT=3160
AGENTS_DEV_INSPECTOR_PORT=3161
RESOURCES_DEV_PORT=3170
RESOURCES_DEV_INSPECTOR_PORT=3171
BAZEL_DEV_SERVER_PORT=3600
BAZEL_REMOTE_CACHE_PORT=3601
DYNAMO_LOCAL_PORT=3610
DYNAMO_LOCAL_GUI_PORT=3611
OPENSEARCH_LOCAL_PORT=3620
SQS_LOCAL_PORT=3630
SQS_LOCAL_STATS_PORT=3631
```

**3. Symlink local Claude settings from the main repo:**

```bash
ln -s ../cyberworlds/.claude/settings.local.json .claude/settings.local.json
```

**4. Install dependencies:**

```bash
pnpm install
```

**5. Ask the user to run `./admin/bin/dev` in a new terminal window**, then wait for them to confirm
it's running before proceeding. It's important the user runs the relative dev script, as `dev` is
likely set in their PATH to the root repo. The app will be available at
`http://localhost:<APP_DEV_PORT>` (e.g., `http://localhost:3110` for worktree-1).

Each worktree has isolated data directories and session cookies, so you can test without affecting
the main environment.
