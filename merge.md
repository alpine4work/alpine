# Merge: main → calebmer/databases (2026-06-10)

Merging 314 commits from `main` (diverged at `a712ab571`, 2026-02-20) into the long-running
databases branch (342 commits ahead). Policy: prefer `main`; where that would break the databases
work, make a judgement call and record it here.

## Conflict resolutions

### New URL scheme — databases routes ported ⚠️

Main's "New URL scheme" (#1600) deleted the `s.$spaceId.*` route convention entirely (including the
`s.$spaceId.tsx` layout) in favor of `_space.*` routes. The branch's 10 databases route files were
orphaned. Ported them following main's `_space.settings.$spaceId.*` layout-with-children pattern:

- `s.$spaceId.databases[.*].tsx` → `_space.databases.$spaceId[.*].tsx` (layout, `_index`,
  `$tableOrViewId`, `new`, `sql`), URLs change from `/s/:spaceId/databases/...` to
  `/databases/:spaceId/...`.
- Peek variants → `_space.peek.databases.$spaceId[.*].tsx` re-exports.
- Updated hardcoded URLs: layout `basePath`, `database_creator.tsx` post-create navigation.
- Regenerated `shared/remix/app_space_route_id.ts` via
  `bazel run //shared/remix:write_app_space_route_id`.
- Re-added databases entries to `client/web/spaces/route_metadata.ts` (note: main removed the
  `spaceSideBarSpacing` concept entirely — dropped from the databases entries) and
  `client/web/shimmer/route_shimmer.tsx` (no shimmer design yet, `false` like sites).
- Re-added the not-found integration test in `app/integration_tests/session/not_found_error.spec.ts`
  with the new URL.

**Open question**: main's entity routes are space-less (`/doc/:id`, `/task/:id`) and derive the
space server-side. Databases tables keep `spaceId` in the URL (`/databases/:spaceId/:tableOrViewId`)
because the loaders resolve the database group from the space. A follow-up could derive the space
from the table id to match the entity-URL convention.

### Create menu

Main redesigned the create menu twice (#1318, #1489); the branch's "Database" item was in the old
menu. Re-added it to `create_widget_secondary_menu_bar.tsx` behind the same dev/Alpine-space gate as
the Sites item (`canRenderDatabaseButton`), navigating to `/databases/:spaceId/new?focus=name`.
Reuses `CreateWidgetDocumentExample` as the example preview (same stand-in sites use) — needs a real
example + brand icon eventually.


## Validation status

- `dev check`: **867/868 pass**. The one failure is pre-existing branch WIP:
  `//server/databases:databases_lint_test` fails on a `NOCOMMIT` marker in
  `database_durable_object_connection.ts` (documents a known fail-closed bug in the per-browser
  page-diff filter — see the comment and `review.md`; it must be resolved before the databases
  branch itself lands).
