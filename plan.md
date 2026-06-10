# Linked records — implementation plan

Linked record fields let a user relate rows in one table to rows in another table (or the same
table). Creating a link field on table A targeting table B also creates a symmetric field on B.
Under the hood every relationship is a join table living in its own per-db file, hidden from
normal users. Views render link cells as arrays of `{id, name}` where `name` comes from the
linked table's record-name field.

## Decisions (settled in design review)

1. **Fully virtual field.** A link field adds no column to either data table, for any
   cardinality. All link state lives in the join table; cell values are materialized at query
   time.
2. **Cardinality is per-side and independent.** Each field of the symmetric pair has its own
   `"one" | "many"` in its config. The creator picks the cardinality of their field; the
   symmetric field defaults to `"many"`. Enforcement is action-layer only: adding a link to a
   full `"one"` side replaces the existing link. No DB uniqueness constraints — indexes are for
   performance only. Switching many→one keeps existing multi-link rows; only new writes are
   constrained.
3. **Self-links are supported**, directed: the symmetric field lands on the same table. The
   field config carries an explicit `side: "source" | "target"` rather than inferring direction
   from table IDs. Self-link join tables still get their own file (uniform with the general
   case).
4. **Join tables register in the existing `_alpine_tables` registry** in the main database, with
   a new `kind` column (`"table" | "join"`). Consumers (`listTableIds`, future pickers/search)
   filter on `kind`. Join tables always live in their own per-db file, attached like any other
   table.
5. **Link targets are restricted to tables in the same database group** (same main file /
   connection family). Validated server-side in the create action, not just in the picker UI.
6. **Hard-coupled lifecycle.** A link field always has a join table and a symmetric partner.
   Deleting either field tears down the whole relationship (when field deletion exists — see
   deferred work). The join file's metadata singleton is the source of truth for
   side→(table, field) mapping; the symmetric field ID is derived from it, never stored in
   field config.
7. **Record name** is tracked explicitly as `name_field_id` on the per-table `_alpine_table`
   singleton, set at table creation to the auto-created "Name" field. That field is
   **undeletable** while marked as the record name. Name values are converted to display text
   via the name field's *provider* (`formatString`), never via SQL `CAST`.
8. **Wire shape: always an ordered array** of `{id, name}`, even for cardinality `"one"`
   (many→one downgrades can leave multiple links). Ordered by join-row creation order; no manual
   reordering in v1. Built as a correlated subquery per link field so cursor pagination on `_id`
   is untouched.
9. **Granular write actions** — `addLink` / `removeLink`, one join-row insert/delete each.
   Optimistic on the client (no ID generation needed; join rows are keyed by the row-ID pair).
   Duplicate adds are idempotent no-ops. No inline record creation from the picker in v1.
10. **Deletion is deferred entirely** (no delete actions exist in the codebase yet). This plan
    records the cascade invariants for whoever builds them.
11. **Picker lists all records** of the linked table (no search in v1; search is a follow-up).
12. **No type conversions** to or from link fields (`updateFieldConfig` already rejects type
    changes; keep it that way).

## Data model

### Main database (new migration in `mainSqliteMigrations`)

```sql
ALTER TABLE _alpine_tables ADD COLUMN kind TEXT NOT NULL DEFAULT 'table'
    CHECK (kind IN ('table', 'join'));
```

Existing rows backfill to `'table'` via the default. The main DB stays an ID-only registry —
`kind` is structural routing info, not user content. `listTableIds` adds `WHERE kind = 'table'`.

Note: `_alpine_tables` is `STRICT`; SQLite allows `ADD COLUMN` with a non-null default on STRICT
tables, so no table rebuild is needed.

### Per-table files (new migration in `tableSqliteMigrations`)

```sql
ALTER TABLE _alpine_table ADD COLUMN name_field_id TEXT;
```

The migration function backfills `name_field_id` to the table's first field
(`MIN(id)` from `_alpine_fields` — field IDs are chronological, and `createTable` always creates
"Name" first). Nullable at the SQL layer for migration simplicity; treated as required at the
app layer (`createTable` sets it going forward). Migrations run server-side only (existing
behavior), so no client/server divergence.

### Join-table files (new migration list)

Join files are *not* per-table files — they must not get `_alpine_table` / `_alpine_fields` /
`_alpine_views`. Add a parallel `joinTableSqliteMigrations: ReadonlyArray<TableSqliteMigration>`
in `sqlite_migrations.ts` with its own `runJoinTableMigrations(db, joinTableId)` (same
`PRAGMA "<schema>".user_version` tracking). Migration 1 creates:

```sql
-- Singleton metadata: the source of truth for the relationship.
CREATE TABLE _alpine_join_table (
    id TEXT PRIMARY KEY,                 -- the join table's own id (same id as in _alpine_tables)
    source_table_id TEXT NOT NULL,
    source_field_id TEXT NOT NULL,
    target_table_id TEXT NOT NULL,
    target_field_id TEXT NOT NULL,
    CHECK (is_id (id)), CHECK (is_id (source_table_id)), CHECK (is_id (source_field_id)),
    CHECK (is_id (target_table_id)), CHECK (is_id (target_field_id))
) STRICT, WITHOUT ROWID;

-- Link rows. Deliberately NO uniqueness constraint on the pair (action-layer enforced)
-- and no cross-file FKs (SQLite cannot enforce FKs across ATTACH-ed files).
CREATE TABLE _alpine_links (
    source_row_id TEXT NOT NULL,
    target_row_id TEXT NOT NULL,
    _created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
    CHECK (is_id (source_row_id)), CHECK (is_id (target_row_id)),
    CHECK (DATETIME(_created_at) IS NOT NULL)
) STRICT;

CREATE INDEX _alpine_links_source ON _alpine_links (source_row_id);
CREATE INDEX _alpine_links_target ON _alpine_links (target_row_id);
```

`_alpine_links` is a plain rowid table (no `WITHOUT ROWID` since we deliberately have no PK).
Both indexes exist purely for the per-row correlated subqueries and for removeLink lookups.

Join table IDs reuse the `DatabaseTableId` brand: the registry, `sql.tableRef`, schema naming
(`_alpine_schema_{id}`), attachment (`server.attach`, client `TableNotAttachedError` →
`tryAttachCachedTable`), and page replication are all keyed on `DatabaseTableId`, and reusing the
brand means none of that machinery changes. The `kind` column is what distinguishes them.

## Field provider layer (`shared/databases/fields/`)

### Virtual-field support in the provider interface

Today `defineDatabaseFieldProvider` assumes a real column (`sqliteType`, `defaultValue`,
`generateCheckConstraint`, `toSqlValue`/`fromSqlValue`). Introduce a second factory in
`database_field_provider.ts`:

```ts
defineVirtualDatabaseFieldProvider({type, valueSchema, configSchema, getDefaultConfig, formatString, ...})
```

and make the registry's provider type a discriminated union, e.g. `storage: "column" | "virtual"`
on the provider object (add `storage: "column"` to the existing factory's return). Call sites
that touch columns branch on it:

- `createField` helper (`database_actions.ts`): skip the `ALTER TABLE ADD COLUMN` for virtual
  providers.
- `renameField`: skip `ALTER TABLE RENAME COLUMN` for virtual fields (metadata-only rename).
- `getViewRowsPage`: select a subquery expression instead of `sql.identifier(columnName)`
  (see query path below).
- `updateCellValue`: assert the field is column-backed (link cells are written via
  `addLink`/`removeLink`, never `updateCellValue`).

**`column_name` stays populated for virtual fields.** `_alpine_fields.column_name` is
`NOT NULL` + `UNIQUE(table_id, column_name)` in the already-shipped migration, and SQLite STRICT
tables can't drop NOT NULL without a rebuild. So link fields keep getting a unique generated
`column_name` slug via `formatUniqueSqlName`; it's simply never used as a real column. This also
keeps the slug reserved so a future real column can't collide confusingly. (Alternative — table
rebuild to make it nullable — rejected as not worth the migration risk.)

### The link field provider (`database_link_field.ts`)

```ts
type DatabaseLinkFieldConfig = {
    type: "link";
    joinTableId: DatabaseTableId;     // which join file backs this field
    side: "source" | "target";        // which column of _alpine_links is "my row"
    cardinality: "one" | "many";
    linkedTableId: DatabaseTableId;   // denormalized for cheap display; immutable
};

type DatabaseLinkValue = ReadonlyArray<{id: DatabaseRowId; name: string | null}>;
```

- `valueSchema`: array of `{id, name}` objects.
- `getDefaultConfig()` can't produce a meaningful config (it needs IDs minted at creation time);
  link fields are created exclusively through the dedicated `createLinkField` action which
  writes an explicit config. Make the generic `createField` action reject `type === "link"`.
- `formatString`: joins names for copy/display (e.g. `"Alpha, Beta"`).
- The `linkedTableId` in config is immutable after creation; `_alpine_join_table` remains the
  source of truth. `updateFieldConfig` must assert `joinTableId`, `side`, and `linkedTableId`
  are unchanged (only `cardinality` and future display options may change).

The symmetric field ID is *derived*: read `_alpine_join_table` and take the other side's
`*_field_id`. Add a small helper (e.g. `readJoinTableMeta(db, joinTableId)`) used by actions and
the query path.

### Client component (`client/web/databases/fields/database_link_field_component.tsx`)

Registered in `database_field_component_providers.tsx` like the existing three. See UI section.

## Actions (`shared/databases/database_actions.ts`)

### `createLinkField` — server-only, `writeLevel: "schema+data"`

Input: `{tableId, viewId, name, linkedTableId, cardinality}`. Server-only because it mints IDs
(`joinTableId`, two field IDs) and attaches a brand-new file, exactly like `createTable`.

Steps:
1. Validate `linkedTableId` exists in `_alpine_tables` **with `kind = 'table'`** (this also
   enforces same-database-group, since the registry only contains this group's tables).
2. Mint `joinTableId: DatabaseTableId`, `sourceFieldId`, `targetFieldId`.
3. `server.attach(joinTableId)`; `runJoinTableMigrations(db, joinTableId)`.
4. Register: `INSERT INTO _alpine_tables (id, kind) VALUES (joinTableId, 'join')`.
5. Write the `_alpine_join_table` singleton (source = the table the user is editing, target =
   the linked table).
6. Insert the **source field** into the source table's `_alpine_fields` with config
   `{type: "link", joinTableId, side: "source", cardinality, linkedTableId}`, plus
   `_alpine_view_fields` rows (passed `viewId`, matching `createField`'s pattern).
7. Insert the **symmetric (target) field** into the linked table's `_alpine_fields` with config
   `{..., side: "target", cardinality: "many", linkedTableId: tableId}`. Default name = the
   source table's display name (read from source `_alpine_table.name`), uniquified against the
   target table's existing field names if needed. Insert `_alpine_view_fields` rows into **every
   view** of the target table (we don't have a caller-supplied view there).
8. Self-link case (`linkedTableId === tableId`): both fields land in the same file; everything
   else is identical. Default symmetric name = same table name; `formatUniqueSqlName`-style
   uniquification on the display name avoids the immediate duplicate.

Refactor note: extract the metadata-insert portion of the existing `createField` helper
(steps: unique column slug, `_alpine_fields` insert, `_alpine_view_fields` insert) so both the
column path and the virtual path share it.

### `addLink` — optimistic, `writeLevel: "data"`

Input: `{tableId, fieldId, rowId, linkedRowId}`. Steps:
1. Read the field's config from `tableId`'s `_alpine_fields`; assert `type === "link"`.
2. Map `side` to columns: mine = `source_row_id` if side is `"source"` else `target_row_id`;
   theirs = the other column.
3. If `cardinality === "one"`: `DELETE FROM <join>._alpine_links WHERE <mine> = rowId` (replace
   semantics).
4. Idempotent insert:
   `INSERT INTO ... SELECT rowId, linkedRowId WHERE NOT EXISTS (SELECT 1 ... WHERE <mine> = rowId AND <theirs> = linkedRowId)`.
5. Optionally validate `linkedRowId` exists in the linked table (read `_alpine_join_table` for
   the other side's table). Cheap, deterministic, and keeps garbage out — do it.

Deterministic (no ID minting, no clock reads besides SQLite's `DATETIME('now')` — confirm the
deterministic-execution machinery already pins SQLite's clock for optimistic re-execution the
same way it must for `_created_at` in `createRow`; if not, follow whatever `createRow` does).
Runs optimistically on the client; the join file attaches lazily via the existing
`TableNotAttachedError` → `tryAttachCachedTable` → `PageMissingError` fallback in
`database_client.ts`.

### `removeLink` — optimistic, `writeLevel: "data"`

Same input shape. `DELETE FROM <join>._alpine_links WHERE <mine> = rowId AND <theirs> = linkedRowId`.
Deleting a non-existent link is a no-op.

### `listTables` — read, `writeLevel: "none"`

The field-creation table picker needs `{id, name}` for every user table; `listTableIds` only
returns IDs and names live in per-table files. New action: read `_alpine_tables WHERE kind = 'table'`,
then each table's `_alpine_table.name`. (Server attaches as needed; on the client this works
when files are cached and falls back to the server via page-miss otherwise.)

### `listRowsForLinking` — read, `writeLevel: "none"`

Input: `{tableId}` (the *linked* table). Reads `name_field_id` → name column, returns all rows
as `{id, name}` ordered by `_created_at` descending (most recent first; matches "what users
likely want to link"). Name values pass through the name field provider (deserialize via
`sqlValueSchema`, then `formatString`) so the output is display-ready strings — same convention
as the view query path. No pagination/search in v1 (follow-up).

### Guards on existing actions

- `createField`: reject `type === "link"` ("use createLinkField").
- `updateFieldConfig`: for link configs, assert `joinTableId`/`side`/`linkedTableId` unchanged.
- `updateCellValue`: assert the target field is column-backed.
- A future `deleteField` must refuse to delete the field referenced by `name_field_id`
  (record-name field is undeletable) — enforce this the moment `deleteField` is written.

## Query path

### `getViewSchema`

No structural change: link fields appear with their config (the `DatabaseFieldConfigSchema`
union picks up the new provider automatically). The client uses `config.linkedTableId` /
`cardinality` to render the field header and editor.

### `getViewRowsPage`

For each link field in the view, instead of `sql.identifier(columnName)` in the SELECT list,
emit a correlated subquery (with the join schema and linked-table schema resolved from config +
`_alpine_join_table` + the linked table's `_alpine_table`/`_alpine_fields` before building the
query):

```sql
(
    SELECT json_group_array(json_object('id', t._id, 'name', t.<nameColumn>))
    FROM <joinSchema>._alpine_links j
    JOIN <linkedSchema>.<linkedTableName> t ON t._id = j.<theirSideColumn>
    WHERE j.<mySideColumn> = <dataTable>._id
    ORDER BY j._created_at, j.rowid
)
```

- Cursor pagination (`_id > after AND _id <= end`, `ORDER BY _id`) is untouched — no GROUP BY,
  no row multiplication.
- Ordering inside the aggregate: SQLite ≥ 3.44 supports `ORDER BY` inside aggregate function
  calls (`json_group_array(... ORDER BY j._created_at)`); if our pinned WASM build is older,
  feed the aggregate from an ordered subquery instead. **Verify the build's SQLite version
  early** (milestone 1) and pick the form accordingly. `j.rowid` tiebreaks equal timestamps.
- The subquery returns the **raw** SQL value of the name column. Post-process in the action's
  `run()` (shared client/server code, both have DB access): parse the JSON text, then for each
  element run the linked table's name-field provider (`sqlValueSchema.deserialize` →
  `formatString` with that field's config) to produce `name: string`. Empty/NULL names surface
  as `null` (UI renders "Untitled"). The column-schema slot for a link field is a JSON-text
  schema; the per-cell conversion happens after `selectAllArrays`.
- NULL handling: a row with no links produces `json_group_array` over zero rows → `[]` (good);
  `json_object('name', NULL)` keeps an explicit null (good).

### Reactivity & replication — no new work expected

The page-tracking hook records reads of the join file's and linked file's pages during
`getViewRowsPage`, so:
- partial replication ships those pages to the client automatically, and
- reactive actions re-execute when a link is added/removed or a linked record's name changes.

Caveat to verify in tests: invalidation granularity is page-level, so edits to *any* field of
the linked table may re-run the view query (the name column shares pages with other columns).
Correct, just potentially chatty — acceptable for v1.

## Client UI (`client/web/databases/`)

1. **Field creation** (wherever the new-field flow lives, near `database_grid_view.tsx`): add a
   "Linked record" type. Selecting it reveals a table picker (fed by `listTables`; includes the
   current table for self-links) and a one/many toggle (default "many"). Submit calls
   `createLinkField` instead of `createField`.
2. **Cell renderer** (`database_link_field_component.tsx`): chips showing each link's `name`
   ("Untitled" for null), registered in `database_field_component_providers.tsx`. Cardinality
   only affects affordances (a "one" field's picker replaces rather than appends).
3. **Cell editor**: popover with the current links (per-chip remove → `removeLink`) and a list
   of the linked table's records (`listRowsForLinking`, reactive) to add (`addLink`). Already-
   linked rows are marked/disabled. No search box, no "create new record" in v1.
4. **Symmetric field appears automatically**: the target table's view schema changes when
   `createLinkField` commits; reactive `getViewSchema` should pick it up without extra plumbing
   (verify in an integration test).

## Implementation order

Each milestone is independently testable and roughly maps to a PR (graphite stack):

1. **Provider layer**: `storage: "column" | "virtual"` split, `defineVirtualDatabaseFieldProvider`,
   link provider with config/value schemas, registry wiring, guards in
   `updateCellValue`/`renameField`/`updateFieldConfig`/`createField`. Verify pinned SQLite
   version for aggregate `ORDER BY`. Unit tests in `shared/databases/fields/`.
2. **Migrations**: main `kind` column + `listTableIds` filter; per-table `name_field_id` +
   backfill + `createTable` sets it; join-file migration list + runner. Tests in
   `database_actions.test.ts` / a new `sqlite_migrations` test.
3. **`createLinkField`**: full creation flow including symmetric field and self-link case.
   Tests: registry row kind, join singleton contents, both fields' configs, symmetric default
   name, self-link, rejection of `kind='join'` / unknown targets.
4. **`addLink` / `removeLink`**: idempotency, "one" replace semantics, linked-row existence
   validation, optimistic client execution (existing optimistic-write test harness).
5. **Query path**: `getViewRowsPage` correlated subquery + name post-processing; `listTables`;
   `listRowsForLinking`. Tests: array shape, ordering, empty cells, name formatting via
   provider (e.g. a number name field), self-link both directions, pagination unaffected,
   reactive invalidation on link change and on linked-name edit.
6. **Client UI**: field creation flow, chip renderer, editor popover. Playwright integration
   test: create link field on A→B, see symmetric field on B, link a record, see the name in
   both directions, rename the linked record and watch the chip update.

## Invariants for deferred work (record here, enforce later)

- **Join rows must not outlive either endpoint row** — a future `deleteRow` must delete
  `_alpine_links` rows referencing the row on either side, across every relationship the table
  participates in (no cross-file FKs exist; this is action-layer work).
- **Relationships must not outlive either endpoint table/field** — a future `deleteField` on a
  link field (or `deleteTable`) tears down both fields, the join singleton's file, and the
  `_alpine_tables` registry row (hard-coupled deletion).
- **The record-name field is undeletable** while referenced by `name_field_id`.

## Follow-ups (explicitly out of v1)

- Search in the record picker (replace list-all in `listRowsForLinking`).
- Inline record creation from the picker (composable: `createRow` + `addLink`).
- Manual link ordering (per-side position columns on `_alpine_links` + reorder action).
- One-directional links (relaxing the symmetric-pair invariant).
- Cross-database-group links.
- UI for changing which field is the record name (data model already supports it).
- Type conversions to/from link fields.
- Row/field/table deletion with the cascades above.
