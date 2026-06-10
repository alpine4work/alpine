---
name: demo
description: |
    Kick off creation of a new scalable demo video in admin/marketing/2026_04_scalable_demos/.
    Use when the user says they want to "make a demo", "record a demo", "create a new demo", or
    similar — this skill gathers the setup details (feature, data, actors, viewport) and then
    scaffolds + fills in the recorder.
---

# Create a scalable demo

Use this skill when the user wants to author a new social media demo video. These demos live in
`admin/marketing/2026_04_scalable_demos/demos/{NNN}_{name}_demo_*.{ts,tsx}` and follow a tight
format: a Playwright-seeded screen recording + a Remotion composition. New demos should default to
the plain full-frame composition style unless the recording shape needs something custom.

**Before doing anything else, read two files:**

1. `admin/marketing/2026_04_scalable_demos/AGENTS.md` — the demo-author cookbook with every API
   pattern for seeding app state (documents, chats, posts, affinity, feed entries, file uploads,
   reactions, etc.) and the full demo-space account roster. You will pull exact code snippets from
   it during this skill. Do not guess at APIs — the cookbook is authoritative, and if something's
   missing from the cookbook, you'll update it at the end.

2. `admin/environment/demo_space/UNIVERSE.md` — the fictional universe: characters (voices, roles,
   working hours), the company, the ongoing projects (tables in the editor, realtime reliability, Q3
   customer survey, sales one-pager, SSO scoping, Q4 planning, hiring, case studies), and the
   six-week timeline (Sep 8 – Oct 17, 2025). **All seeded content — document titles, chat messages,
   post bodies, task names, timestamps — must be consistent with UNIVERSE.md.** Pick material from
   the projects already in flight rather than inventing parallel storylines.

## Process

### Step 1: Understand the demo

Ask one question at a time, waiting for the answer before the next question. Do not batch. Minimum
questions (ask in this order, skipping any the user has already volunteered):

1. **What feature or interaction does this demo show?** (1-2 sentence summary — "toggling the share
   switch on a document", "dragging images to rearrange a gallery post", etc.)

2. **What page(s) of the app does the viewer need to see?** (e.g. a document editor, a task view,
   the feed). If there's a specific URL shape they have in mind, note it.

3. **Who is the "driver" — whose screen are we watching?** Default to Cass (per UNIVERSE.md's
   "Perspective" section — most screenshots are from Cass's logged-in view). Pick a different
   demo-space account (Rose, Matt, Mason, Elle, Cliff, or Holly) only when there's an in-fiction
   reason (e.g. Matt's design doc, Elle's postmortem). Only fall back to a throwaway
   `TestSpace.create` + anonymous `createSession` if the demo is truly single-person and no
   face/name appears on screen.

Then ask follow-ups as needed to fill in the setup. These are the usual ones — ask only those that
matter for this demo:

4. **Are any other people involved?** (comments, chat partners, reactions from others, mentions,
   assignees, …) For each, capture which demo-space account plays the role.

5. **What app content needs to exist before recording?** Walk through each category the cookbook
   covers and ask if it applies:
    - Documents (with title, body sketch, public/private, comments?)
    - Forum channels + posts (channel name, post bodies, reactions from which accounts?)
    - Chat threads (DM vs group vs room, messages with realistic timestamps?)
    - Tasks (hierarchy? assignees? statuses?)
    - File attachments (images in posts/docs? note which fixture files or whether new fixtures are
      needed)
    - Feed entries (for demos set on the feed — remember these go through `/dev/feed?entries=…`)
    - **Affinity ("suggested") ordering** — if a specific entity should top a suggested list from
      someone's perspective, capture the ordering
    - Inbox / notification state

6. **Any UI state to prepare before the human presses record?** (hide sidebar, dismiss a tooltip,
   pre-fill a field, focus a particular element) — goes in `prepare: async page => {…}`.

7. **Should this be an automated recording or a manual one?** Ask whether they want automated
   cursor/typing/clicking via `actions` + `createDemoCursor`, or whether they want to pilot the UI
   themselves while the recorder only seeds the state and shows instructions.

Keep questions targeted — skip entire categories that clearly don't apply (no need to ask about chat
for a document-editing demo). If the user has already described the feature in enough detail, you
can confirm a proposed setup instead of re-interrogating.

### Step 2: Confirm the plan

Before touching code, restate the plan in ~10 lines:

- Demo name (snake_case, no `_demo` suffix — the tool appends that)
- Driver account + other accounts in play
- Seeded entities (one line each)
- Landing path
- Viewport + prepare hooks
- Recording mode (`automated` with cursor/typing actions vs `manual`)

Get a yes from the user before scaffolding.

### Step 3: Scaffold

Run `./admin/bin/dev demo new --name <snake_case_name>`. This:

- Creates `demos/{NNN}_{name}_demo_{composition,recorder,shared}.{ts,tsx}` from the templates.
- Registers the `<Composition>` in `scalable_demos_remotion_root.tsx`.
- Adds a placeholder entry to `SCALABLE_DEMOS_REPOSITORIES` in `scalable_demo_repositories.bzl`.

### Step 4: Fill in the recorder

Edit the generated `{NNN}_{name}_demo_recorder.ts` using the patterns from `AGENTS.md`:

- Import `createDemoSpace` if the demo uses demo-space accounts.
- Seed the entities in the order they'll appear on screen (use `runAllPromises` for siblings that
  don't depend on each other).
- Use `overrideCreatedTime` when relative timestamps matter.
- If a "suggested list" ordering is requested, use `addSearchAffinityEntityPointsForTest` with
  descending large point values (`999_000_000`, `998_000_000`, …) — see
  `fictional_ambrook_suggestions.ts`.
- If the user chose **automated recording**, implement the interaction in `actions: [...]` and use
  the cursor/typing patterns from `AGENTS.md` (`createDemoCursor`, `moveToElement`, `clickElement`,
  `pressSequentially`, `wait`).
- If the user chose **manual recording**, leave the interaction for the human and make the
  `instructions` markdown concrete enough to follow live.
- Pass `session`, `path`, `viewport`, `prepare`, and a good `instructions` markdown string to
  `recorder.record(...)`. **The `instructions` are read both by you (during recording) and by
  `dev demo content-prompt` (when generating social copy) — make them descriptive.**

Also update the generated `{NNN}_{name}_demo_composition.tsx` if the viewport or recording shape
needs something custom, but default to the plain full-frame composition template.

### Step 5: Verify

```bash
./admin/bin/dev check admin/marketing/2026_04_scalable_demos/demos/{NNN}_{name}_demo_recorder.ts
```

This runs typecheck, lint, and format via Bazel against the new files.

### Step 6: Hand off for recording

Tell the user:

1. Run the recorder to start Playwright and set up the app state:

    ```bash
    ./admin/bin/dev demo run {NNN}
    ```

    Accepts `5`, `005`, or `005_{name}` — all resolve to the same recorder.

2. Follow the `instructions` shown in the terminal to take the screen recording.
3. Upload the `.mov` to the scalable demos Google Drive folder.
4. Fill in `url` + `integrity` for `{NNN}_{name}_demo_recording_01.mov` in
   `scalable_demo_repositories.bzl`.
5. Fill in frame numbers in `demos/{NNN}_{name}_demo_shared.ts` after reviewing the recording in
   `dev demo studio`.

## Self-update rule

If during Step 4 you discover a new entity type, interaction, or pattern that isn't documented in
`AGENTS.md`, update `AGENTS.md` in the same change. The cookbook only stays useful if it keeps up.

## Reference

- `admin/marketing/2026_04_scalable_demos/AGENTS.md` — the cookbook (read first every time).
- `admin/scenarios/internal/fictional_ambrook_*.ts` — rich real-world examples of every entity type.
