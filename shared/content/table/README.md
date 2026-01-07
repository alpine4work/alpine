The files in this directory were forked from `prosemirror-tables` (commit
[582b4e4](https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb)).
We forked `prosemirror-tables` to remove features we don't use and customize the user experience.
The files from `prosemirror-tables` were split between `client/content/state/table`,
`client/content/internal/table`, and `shared/content/table`. Everything in `shared/content/table` is
needed across both the client and the server. Everything in `client/content/state/table` and
`client/content/internal/table` is just needed in our client `<ContentEditor>`.

The files from `prosemirror-tables` map to the following files in our repository:

- `src/cellselection.ts` → `shared/content/table/content_table_cell_selection.ts`
- `src/columnresizing.ts` → `client/content/state/table/content_editor_table_plugin.ts`
- `src/commands.ts` → `client/content/state/table/content_table_commands.ts`
- `src/copypaste.ts` → `client/content/state/table/content_table_copy_paste.ts`
- `src/fixtables.ts` → `client/content/state/table/content_table_fix_tables.ts`
- `src/index.ts` → `client/content/state/table/content_editor_table_plugin.ts`
- `src/input.ts` → `client/content/state/table/content_table_input.ts` (with some stuff moved to
  `client/content/state/table/content_editor_table_plugin.ts`)
- `src/schema.ts` → `shared/content/table/content_table_schema.ts`
- `src/tablemap.ts` → `shared/content/table/content_table_map.ts`
- `src/tableview.ts` → `client/content/internal/table/content_editor_table_node_view.ts`
- `src/util.ts` → `shared/content/table/content_table_shared_util.ts` and
  `client/content/state/table/content_table_client_util.ts` (depending on whether the utility is
  needed on the server or not)

We've made some modifications to the forked files to make sure they match our code base conventions.
For example, file names are namespaced with `content_table_*` and module exports are namespaced
(e.g. `cellAround()` from `src/util.ts` was renamed `cellAroundContentTable()`). However, in order
to maintain the structure of the `prosemirror-tables` package we've chosen to leave utility files
together instead of breaking them up into individual files as our code style guide normally
recommends (this includes `src/util.ts` and `src/input.ts`).
