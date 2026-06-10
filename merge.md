# Merge: main → calebmer/databases (2026-06-10)

Merging 314 commits from `main` (diverged at `a712ab571`, 2026-02-20) into the long-running
databases branch (342 commits ahead). Policy: prefer `main`; where that would break the databases
work, make a judgement call and record it here.

## Conflict resolutions

### Trivial both-sides additions (kept both)

- `.gitignore` — kept branch's `/client/native` NOCOMMIT entry plus main's new entries.
- `shared/id/types/id_types.ts` — kept branch's `Database*Id` types plus main's `Site*Id` types.
- `tsconfig.json` — kept main's new `~/admin/*` path mapping (with its comment) plus the branch's
  `~/external/*` mapping (used by all `shared/databases` sqlite type imports).

### `admin/eslint/rules/string-quotes.js` (+ test file)

Main rewrote template-literal handling (`TemplateElement` → `TemplateLiteral` with `ignoreNextMatch`
state); the branch had added an exemption for `sql`-tagged template literals (SQL needs straight
quotes). Took main's rewrite and re-applied the sql exemption at the top of main's new
`TemplateLiteral` visitor. Test file: kept both sides' test cases.

### Prettier plugins — REAL COLLISION, resolved with a new composed plugin ⚠️

- Branch added `prettier-plugin-embed` + `prettier-plugin-sql` to auto-format `sql`-tagged templates
  (`prettier.config.cjs`, format-test data in `admin/typescript/typescript.bzl`).
- Main added a custom estree plugin that formats comments as markdown
  (`admin/prettier/plugin/prettier_estree_plugin_with_markdown_comments.cjs`) and consolidated
  format-test data into a `//:prettier_config_files` filegroup.
- **Problem**: Prettier resolves the `estree` printer from a single plugin, so the two plugins
  cannot both be listed — empirically verified that in either order one of the two features is
  silently disabled (and main's files then fail `--check`). The pre-merge auto-merged config even
  had two `plugins:` keys (the second silently discarding main's plugin).
- **Resolution**: the two plugins override _disjoint_ printer methods (markdown comments:
  `preprocess` + `printComment`; embed: `embed`), so I wrote a small composing plugin —
  `admin/prettier/plugin/prettier_estree_plugin_with_markdown_comments_and_embed.mjs` (ESM because
  `prettier-plugin-embed` is ESM-only) — that merges them into one estree printer. Verified both
  features work: main's markdown-formatted comments pass `--check` unchanged AND sql templates
  format. **This is new code written during the merge — review it.**
- Plumbing: config plugins are now `[composed plugin, "prettier-plugin-sql"]`; added the `.mjs` to
  the plugin package's `copy_to_bin` + negative test data; added the two sql plugin `node_modules`
  labels to the `//:prettier_config_files` filegroup in the root `BUILD`.
- Fallout: ran a one-time reformat (~100 files) — branch files had never been through main's
  markdown comment formatter, so their comments reflowed. Pure formatting, no code changes.

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

### Search entity model refactor — Database re-registered ⚠️

Main's "Refactor initialData for SearchEntityModel" (#1514) was backwards-incompatible and deleted
`client/web/search/core/search_entity_type_display.tsx` (replaced by `get_search_entity_icon.tsx` +
registry). The branch had registered Database as a first-class search entity against the OLD model.
Ported:

- `shared/search/search_entity_id.ts`: kept Database in the affinity-id axes (branch) and main's
  mention-entity changes (Chat is now mentionable; Database is not).
- `shared/search/search_entity_model.ts`: **added a new `Database` model variant**
  (`SearchDatabaseEntityModelDataSchema`, mirroring Document's `{id, version}` shape) plus cases in
  `printSearchEntityModelId()` and `mergeSearchEntityData()`. The branch never had this (the old
  model didn't need it); written fresh during the merge — review the merge semantics (version +
  title compare, same as Document).
- `client/web/search/core/get_search_entity_icon.tsx`: Database case using `DocumentBrandIcon` as a
  stand-in (branch's TODO carried over).
- `client/web/search/core/get_search_entity_path.ts`: the auto-merge dropped the branch's old
  string-returning Database case inside main's refactored object-returning function (would not have
  compiled). Fixed: Database → `{type: "Database", databaseTableId}` id object +
  `/databases/:spaceId/:tableOrViewId` path case.
- `server/search/...`: kept the branch's indexing stubs (getDatabase returns null /
  getDatabaseSearchEntity throws NotFound — Database entities aren't actually indexed yet) merged
  with main's new Site/AccessPolicy methods.
- `server/api/.../into_api_search_result.ts`: Database returns null (not exposed in API), Site
  throws Unimplemented (main).

### Durable objects / tokens — both sides added a service

Branch added `DatabaseGroupService`/`DatabaseGroupDurableObject`; main added
`SiteRealtimeService`/`SiteRealtimeDurableObject`. Kept both everywhere (tracer service names, token
service names + short name `dbg`, token agent key switches, edge service env, routing in
`edge_service.ts`, test token agent).

- `server/edge/wrangler.toml`: main's already-deployed migration keeps `tag = "v7"`
  (SiteRealtimeDurableObject); the branch's `new_sqlite_classes = ["DatabaseGroupDurableObject"]`
  migration moved to **`tag = "v8"`**. Also moved the binding up next to the other bindings.
- `server/context/edge_service_context_module.ts`: both sides independently added the same
  capability — branch's `fetchDurableObject()` vs main's `sendRequestToDurableObject()`
  (near-identical implementations). Took main's, migrated the branch's one caller
  (`server/databases/data/fetch_database_action.ts`).

### pnpm-lock.yaml

Regenerating the lock from scratch is broken even on clean main (`ERR_PNPM_PATCH_NOT_APPLIED` for
psl/micromark patches — full re-resolution floats those transitive deps past the patched versions).
Also note the repo pins pnpm 9.12.1 (WORKSPACE) while `pnpm` on PATH is 8.3.1, which silently forces
full re-resolution (lockfileVersion 9 vs 8). Resolution: took main's lock verbatim, then ran
`npx pnpm@9.12.1 install --lockfile-only` with the merged package.json — minimal diff
(prettier-plugin-embed/sql added, miniflare patch hashes, packageExtensions checksum).

### Create menu

Main redesigned the create menu twice (#1318, #1489); the branch's "Database" item was in the old
menu. Re-added it to `create_widget_secondary_menu_bar.tsx` behind the same dev/Alpine-space gate as
the Sites item (`canRenderDatabaseButton`), navigating to `/databases/:spaceId/new?focus=name`.
Reuses `CreateWidgetDocumentExample` as the example preview (same stand-in sites use) — needs a real
example + brand icon eventually.

## Post-merge integration fixes (typecheck/lint fallout)

Main's refactors introduced exhaustive switches over unions the merge extended with `Database`.
Added `Database` cases to:

- `shared/search/get_author_from_search_entity_if_exists.ts` — no author, like Document.
- `shared/sites/site_model.ts` `isSiteEntrySearchEntityModelData()` — Database is NOT a valid site
  entry (could be revisited).
- `client/web/search/core/search_entity_view_title.tsx` — no title media, like Document.
- `client/web/content/render_content_mention_to_html.ts` — no mention icon branch (Database isn't
  mentionable, but the type union flows through here).
- `server/search/data/index/search_entity_index.ts` — (1) spot-check: skip (not indexed, not
  mentionable); (2) hit-to-model conversion: throw `InternalError` since Database entities are never
  indexed yet (stale legacy entries only).
- `app/screenshot_tests/shimmer_screenshot_test.ts` — added the 5 databases routes to
  `IrrelevantAppSpaceRouteIdWithoutShimmer` (no shimmer design yet, same as sites).

Other fixes:

- `server/databases/data/BUILD` depended on `//server/dynamo/core/general_realtime`, which main
  renamed to rynamo (#1486) and moved to `//server/rynamo`. No TS file in the package actually
  imported it — removed the stale dep.
- `.eslintrc.cjs`: added `ignorePatterns: ["admin/external_types/"]` — the branch vendors
  `sqlite3.d.mts` (written by `write_source_files` from the sqlite distribution) which ESLint can't
  parse and shouldn't lint.
- Fixed new string-quotes lint warnings (main's rule now flags raw curly quotes in plain strings) in
  4 branch files; replaced with `’`-style escapes.

## Validation status

- `dev check`: **867/868 pass**. The one failure is pre-existing branch WIP:
  `//server/databases:databases_lint_test` fails on a `NOCOMMIT` marker in
  `database_durable_object_connection.ts` (documents a known fail-closed bug in the per-browser
  page-diff filter — see the comment and `review.md`; it must be resolved before the databases
  branch itself lands).
- `dev test`: **516/516 pass**. (Two OpenSearch-backed tests flaked with `fetch failed` on the
  first run and passed on re-run.)

## Extras

- Added a `databases` case to `shared/search/convert_legacy_space_path.ts` (+ test cases) so old
  `/s/:spaceId/databases/...` URLs 301-redirect to the new scheme like every other legacy route.
