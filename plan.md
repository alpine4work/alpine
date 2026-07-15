# Database sync protocol rework — implementation plan

Branch: `alex/better-sync`. Design settled 2026-07-15 (full analysis in git history:
`sync_design_report.md` @ `8041f6215`).

Nothing here is in production, so there are no backfills, compatibility windows, or legacy
readers to preserve — schemas and protocol shapes are replaced in place.

## Settled design

- **Latest-image page storage.** The Durable Object keeps exactly one row per
  `(sqlite_id, page_index)`: the newest page image, or a `NULL`-data **tombstone** for a
  deleted/truncated page. `version` stays the existing per-DO global monotonic counter,
  stamped once per `writePages` batch. Tombstones are retained indefinitely for now (rows
  are tiny once data is NULL) — they are what makes "changed since V" report deletions.
- **Per-table client watermarks, global version space.** A client tracks, per table file,
  the highest global version it has fully incorporated for that table (persisted in the
  OPFS index). No per-table version counter exists anywhere — the watermark is a cursor
  into the existing global sequence. Watermarks advance only on events/responses *for that
  table*; lag while a table is quiet is harmless (empty catch-up diff).
- **Fallback-registered subscriptions.** Cold start does nothing: no validation, no
  attach. The first action to touch an unregistered table throws (existing
  `TableNotAttachedError` path) and falls back to the server. The fallback request carries
  `{watermark, heldPages bitset}` for **every cached-but-unregistered table** (the client
  can't predict join fan-out; the set shrinks to empty as the session warms up). Every
  table the server-executed action *read* becomes a subscription for that connection.
  The response inlines catch-up for newly registered tables.
- **The unregistered-table gate (load-bearing invariant).** A cached table must never
  serve local reads until registered on the current connection epoch — otherwise a table
  cached last session but untouched this session silently serves stale data (it was never
  subscribed, so its realtime is filtered). Attach-on-miss becomes attach-after-register.
- **Exact bitsets, not bloom filters.** Page indexes are dense small integers (≤262,144);
  a plain bitset is smaller than a bloom filter *and* exact. Bitsets travel client→server
  in fallback/registration requests.
- **Dedup rule.** The server may skip a page X of table T from a response iff the
  *request's* bitset contains X **and** stored `version(X) ≤` the request's watermark for
  T. Dedup must only ever consult client-sent bitsets — never the server's drifted copy —
  or an evicted page livelocks (the bloom-false-positive failure mode).
- **Superset discipline.** The server's per-connection bitset copy is a superset: replaced
  when the client sends a fresh bitset, OR-ed when the server sends pages, never
  subtracted. Superset staleness only over-sends (clients skip diffs with no base —
  existing behavior); it never drops a held page's diff.
- **Realtime filtered by subscription + bitset**, with three carve-outs:
  1. The originator's own mutation is never bitset-filtered — its optimistic write-set may
     be absent from the server's copy, and filtering it puts a refetch on the just-edited
     row. (The empty-confirmation path for `mutationId` dequeue is preserved as today.)
  2. When all of a subscribed table's diffs filter out, still send a
     `{version, fileSizeInPages}` stub — file size must stay current on a sparse cache,
     and it keeps watermarks from lagging.
  3. `previousVersion === 0` diffs (new pages) are applied client-side against a zero
     base instead of skipped — this kills the read-miss round trip for the commonest
     realtime case (row insert → page append/split). The server already diffs new pages
     against a zero page; the fix is client-only.
- **Reconnect = re-registration.** The client re-sends `{watermark, bitset}` for its
  registered set in one batch; the server rehydrates its in-memory view and returns inline
  catch-up. Replaces `ensureCacheIsUpToDate`: O(tables × bitset) up, O(changed ∩ held)
  down — versus O(all cached pages) both ways today.
- **Per-connection server state is small and correctness-free.** `Map<tableId, {bitset,
  watermark}>` per connection (~125 B/table typical vs ~50–100 B/page today). Losing it
  only costs bandwidth. `BrowserPageTracker`, `acknowledgePages`, and the
  pending/confirmed tiers are deleted. The wire shape keeps a Graft-style escape hatch:
  if this memory ever matters, the server can stop retaining bitsets and downgrade to
  table-level filtering without a protocol change.
- **Loader seeds carry a per-table snapshot version** so watermarks initialize; per-page
  versions alone leave a seeded table at watermark 0 (degenerate first registration).

## Verified facts the plan relies on

- `version` is one monotonic counter per DO, bumped once per `writePages` batch, recovered
  from `MAX(version)` on cold load (`database_server.ts:119-121, 435-495, 614-628`).
- The server already computes new-page diffs against a zeroed 4 KiB page with
  `beforeVersion: 0` (`database_server.ts:812-818`); `buildDatabasePageDiffs` passes that
  through as `previousVersion` (`build_database_page_diffs.ts:35-40`). The client
  currently skips any diff whose base it lacks (`database_client.ts:577-578`).
- Attach-on-miss + server fallback already exist (`database.ts:802-838`,
  `isServerFallbackError` → `executeActionViaServer`, `database_client.ts:341-345,
  940-944`); eager attach is documented as an optimization (`database_client.ts:284-306`).
- `clientMightHavePage` is dead code — realtime is filtered by table *access* only
  (`database_durable_object_connection.ts:317-332`); the tracker's only live consumer is
  `filterReadPages` on fallback responses (`:139-149`).
- Realtime diffs already self-heal per page: `previousVersion` mismatch tombstones the
  page for refetch-on-demand (`database_client.ts:582-593`); tombstones reject stale late
  writes via `writePageIfNewer`.
- A single mutation = one buffer drain = one version across all touched tables
  (`database_server.ts:907-913`); WebSocket event order is the delivery order.
- The OPFS index (`opfs_page_store.ts`) already persists `fileSizeInPages` per table —
  the watermark is one more field there.
- `sqlitePageSize = 4096`, `sqliteMaxPageCount = 262144` (32 KiB worst-case bitset),
  attach eviction at 115 (`sqlite_constants.ts`).

---

## Milestone 1 — Server storage: latest-image pages + per-table sync metadata

**`server/databases/database_durable_object_sql_migrations.ts`**
- Replace the page-table migration in place (no production data):
  ```sql
  CREATE TABLE database_table_pages (
      sqlite_id  INTEGER NOT NULL,
      page_index INTEGER NOT NULL,
      version    INTEGER NOT NULL,
      data       BLOB,               -- NULL = tombstone
      PRIMARY KEY (sqlite_id, page_index)
  ) WITHOUT ROWID;
  CREATE INDEX database_table_pages_by_version
      ON database_table_pages (sqlite_id, version);
  ```
- Add to `database_tables`: `file_size_in_pages INTEGER NOT NULL DEFAULT 0` and
  `last_version INTEGER NOT NULL DEFAULT 0`, updated transactionally in `writePages`.

**`server/databases/database_server.ts`**
- `readPage`: plain PK lookup — delete the `ORDER BY version DESC LIMIT 1` and the
  correlated `MAX(version)` in `getFileSize`/truncate scans.
- `writePages`: compute the **final state per page** for the batch first (truncate
  tombstones minus pages re-written by the same batch), then a single
  `INSERT ... ON CONFLICT (sqlite_id, page_index) DO UPDATE` per page. This fixes the
  truncate/re-extend PK-collision bug from review.md by construction.
- `getFileSize`: read `database_tables.file_size_in_pages` (kept in the existing
  in-memory `fileSizes` map); write it in the same transaction as the pages.
- `_nextVersion`: recover from `MAX(last_version)` over `database_tables` instead of
  scanning all pages.
- New `changedPagesSince(tableId, sinceVersion)`: via the `(sqlite_id, version)` index,
  return `{changedPageIndexes: Set<number>, tombstonedPageIndexes: Set<number>}` for rows
  with `version > sinceVersion`. Fast path: `last_version ≤ sinceVersion` → table
  unchanged, no query.
- Audit every remaining query against the new schema/indexes (bootstrap sweep, truncation,
  registration lookups) — each should be PK- or index-served; note the plan in a comment
  where a scan is deliberate.

**Tests** (`database_server.test.ts`)
- Truncate + re-extend the same page in one `writePages` batch (regression for the review
  bug); final state wins, no uniqueness violation.
- Row count stays O(live pages) after N repeated edits of one page (growth regression).
- `changedPagesSince` reports writes and tombstones, respects the fast path, and returns
  empty for a current watermark.
- Cold-load recovery of `_nextVersion` and `fileSizes` from `database_tables`.

## Milestone 2 — Client materializes new pages from realtime

**`client/web/databases/worker/database_client.ts`** (`writePageDiffsFromRealtime`)
- When `base === null && previousVersion === 0`: apply the diff against a zeroed
  `sqlitePageSize` buffer and `writePageIfNewer(pageIndex, version, full)`. Tombstone
  ordering is already handled by `writePageIfNewer` (a tombstone at ≥ version rejects).
- `base === null && previousVersion > 0` keeps the current skip (the page predates the
  client's knowledge; refetch on demand).
- Hoist a shared zeroed-page constant next to `applyPageDiff` if one doesn't exist.

**Tests** (`database_client.test.ts`)
- A row insert that appends a new page lands in OPFS from the realtime event alone (no
  fallback on subsequent read).
- A client-side tombstone at a newer version is not resurrected by a late zero-base diff.
- Page-0 noise filtering (`shouldIgnorePageInvalidation`) is unaffected.

## Milestone 3 — Shared protocol: bitsets, registration schemas, event version

**New `shared/databases/page_bitset.ts`**
- `encodePageBitset(Set<number>) → Uint8Array` / `decodePageBitset` (byte-aligned bitset,
  length `ceil(maxIndex/8)`; 32 KiB worst case, ~125 B for a 4 MB table), plus
  `pageBitsetHas`, `pageBitsetUnion`, `pageBitsetIntersect`. Document that the encoding is
  an internal wire detail (RLE/Roaring can replace it later without protocol change).

**`shared/databases/database_protocol_schemas.ts`**
- `DatabaseTableRegistrationSchema = {watermark: integer, heldPages: bytes}`.
- Extend `DatabaseExecuteActionInputConfig` with
  `registerTables: Map<tableId, DatabaseTableRegistration>` (default empty map).
- New per-table registration result, used by both the action response and the reconnect
  procedure:
  ```
  Map<tableId, {
      watermark: integer,                 // new client watermark (snapshot version)
      fileSizeInPages: integer,
      catchUp:
        | {type: "current"}
        | {type: "pages", pages: DatabaseTablePages}          // changed ∩ bitset, inlined
        | {type: "stale", pageIndexes: bytes /* bitset */}    // over inline limit: drop these
        | {type: "resync"}                                    // reserved (future tombstone GC)
  }>
  ```
  plus `tableAccess` (same semantics as today's `ensureCacheIsUpToDate` response,
  including join-side levels).
- Extend `DatabaseExecuteActionOutputConfig` with `registeredTables` (above) and a
  `readPagesSnapshotVersion: Map<tableId, integer>` so fallback/loader consumers can set
  watermarks.
- Add `version: integer` (the batch version) to `DatabaseTablePageDiffsSchema` — needed
  for the all-filtered stub and for watermark advancement independent of per-page diffs.
- `LoaderDatabaseActionResultSchemas`: include the per-table snapshot version alongside
  `readPages`.

**`shared/databases/database_realtime_protocol.ts`**
- New `registerTables` procedure: request `Map<tableId, DatabaseTableRegistration>`,
  response `{tables: <registration result>, tableAccess}`. (`ensureCacheIsUpToDate` stays
  until Milestone 6.)

**Tests**: bitset round-trip/edge cases (empty, dense, max index), schema round-trips.

## Milestone 4 — Server: registration, catch-up, dedup, filtered realtime

**`server/databases/database_durable_object_connection.ts`**
- Per-connection `subscriptions: Map<DatabaseTableId, {heldPages: bitset, watermark:
  number}>` (dies with the connection object — no refcounting, no browser keying).
- `registerTables` handling (shared by the procedure and the `executeAction` piggyback):
  per table — access check (withhold `null`-access tables exactly like today's
  `ensureCacheIsUpToDate`, including join-side `tableAccess` entries); compute catch-up via
  `changedPagesSince(tableId, watermark)`:
  - unchanged → `{type: "current"}`, subscribe, store bitset/watermark;
  - changed ∩ request bitset ≤ inline limit (new constant replacing
    `cacheUpdateStalePageLimit`, e.g. `registrationCatchUpInlinePageLimit`) → inline full
    pages, plus tombstoned indexes folded into `stale`;
  - over limit → `{type: "stale"}` with the changed∩bitset indexes as a bitset.
- `executeAction`: after execution, subscribe every table in the action's read set;
  apply the **dedup rule** to `readPages` using only the request's bitsets+watermarks
  (tables without a request entry are sent unfiltered); OR sent pages into stored bitsets.
  Delete the `filterReadPages`/`addPendingPages` tracker calls.
- `transformEvent` (`PagesChanged`): keep the access check; drop diffs for unsubscribed
  tables; within a subscribed table, drop diffs whose page is outside the stored superset
  bitset — **except** when this connection originated `mutationId` (send unfiltered and OR
  the write-set into its bitset). When a subscribed table's diffs all filter out, emit the
  `{version, fileSizeInPages}` stub (empty diffs map + new `version` field). The
  empty-confirmation event to the originator is unchanged.
- On `TableMetadataChanged` access revocation (`tableAccess` → null): drop the table from
  `subscriptions` (the transformEvent access check stays as belt-and-suspenders).

**Tests** (`database_durable_object_connection.test.ts`)
- Registration: current/pages/stale modes, inline limit boundary, access-withheld table,
  join-side access entries.
- Dedup: page skipped iff request-bitset hit ∧ version ≤ watermark; **evicted-page
  regression** — a page absent from the request bitset is always sent even if the stored
  superset claims it (livelock guard).
- Realtime: unsubscribed table filtered; out-of-bitset page filtered; originator
  unfiltered; stub emitted with correct version/fileSize; revoked table unsubscribed.

## Milestone 5 — Client: lazy start, registration gate, reconnect, watermarks

**`client/web/databases/worker/opfs_page_store.ts`**
- Persist `watermark` in the index file; expose `getHeldPagesBitset()` (from the in-memory
  index map) and `setWatermark`.

**`client/web/databases/worker/database_client.ts`**
- Delete the cold-open `ensureCacheIsUpToDate` call and `attachKnownTables`. `create` no
  longer eagerly opens every OPFS store — enumerate the group dir once, lazily, at first
  fallback (open stores in parallel with `runAllPromises` — closes the serial-open review
  item for this path).
- Track `registeredTables: Set<DatabaseTableId>` per connection epoch. The attach gate:
  a table may only attach (and thus serve local reads) when registered. Unregistered →
  existing `TableNotAttachedError` → fallback.
- `executeActionViaServer`: attach a `registerTables` payload covering every
  cached-but-unregistered table (watermark + bitset from the OPFS store). Apply the
  response: `pages` → `writePageIfNewer` each; `stale` → tombstone those indexes;
  `resync` → drop the table's OPFS store; then set watermark + fileSize, mark registered,
  attach if the header page is present. Set watermarks for `readPages` tables from
  `readPagesSnapshotVersion`.
- `writePageDiffsFromRealtime`: advance the table watermark to the event's `version`
  (applied, skipped, or stub — the table is subscribed, so delivery order guarantees no
  gap); apply stubs' `fileSizeInPages`.
- `seedPages`/`writeLoaderPages`: set watermarks from the loader's snapshot versions.
  Loader-seeded tables are still unregistered — the gate stands until first fallback
  registers them (seeded pages just make that registration's catch-up empty).

**`client/web/databases/worker/database_connection_manager.ts`**
- `revalidateCacheAfterReconnect` → `reregisterAfterReconnect`: call the `registerTables`
  procedure with the registered set's current watermarks+bitsets, apply per-table catch-up
  (same application path as fallback registration), then `replayOptimisticQueue`.
- Reset `registeredTables` on every new connection epoch.

**Tests** (`database_client.test.ts`, `database_connection_manager.test.ts`)
- **Gate**: a table cached in OPFS but untouched this session is not readable locally;
  first touch falls back, registers, then serves locally.
- Fallback carries registrations for all cached-but-unregistered tables; a join table
  discovered server-side converges in one extra round (registered on the retry's
  fallback).
- Reconnect: writes landed while disconnected arrive via catch-up (inline and stale
  modes); optimistic queue replays on top.
- Truncate-while-disconnected: catch-up tombstones + new fileSize shrink the cached file
  correctly.
- Watermark: advances on applied diffs, skipped diffs, and stubs; a quiet table's lagging
  watermark yields an empty catch-up.

## Milestone 6 — Delete the old protocol

- Remove `ensureCacheIsUpToDate` and `acknowledgePages` from
  `database_realtime_protocol.ts`, the connection, and the client.
- Delete `BrowserPageTracker`, its tests, the `registerConnection`/`handleClose` wiring,
  and the `trackPages` query param.
- Delete `cacheUpdateStalePageLimit` and `DatabasePageVersionsByIndexSchema` /
  `DatabasePageIndexesSchema` if unreferenced.
- `dev check` sweep for dead exports; update the protocol doc comments in
  `database_protocol_schemas.ts` to describe the registration model.

## Milestone 7 — Integration hardening

Integration tests (Playwright / worker-level) covering the invariants end-to-end:
- Two clients on one group: A mutates, B (subscribed, holding the pages) applies diffs
  without any fallback request; B without the pages gets them on next read only.
- New-row realtime: B holding the table's hot pages sees an appended page materialize
  (zero-base apply) with no fallback.
- Originator flow: optimistic mutation confirms via realtime, cache stays warm (no
  refetch of the just-written pages).
- Reload/reconnect storm: N simulated clients re-register concurrently; assert request
  payloads are O(tables) and the DO does no per-page point-read loops.
- Staleness: client caches table, disconnects, table mutated, client reconnects and reads
  — sees fresh data through catch-up, never the stale page.
- Access revocation mid-session stops that table's diffs and drops the subscription.

## Punted / out of scope

- **Tombstone GC + `resync` trigger.** Tombstones are kept forever for now; the `resync`
  catch-up variant is wired but never returned. Revisit with a per-table horizon version
  once storage numbers justify it.
- **Bitset compression** (RLE/Roaring/Splinter) — plain bitsets first; encoding is
  swappable behind `page_bitset.ts`.
- **Graft-mode server** (drop retained bitsets, metadata-only catch-up, notify-then-pull) —
  the protocol already permits it; only worth it if per-connection memory shows up.
- **Whole-table rolling checksum** (LiteFS-style `XOR crc64(pageIndex, data)`) for
  registration-time integrity proof — cheap, but additive; do after the base protocol.
- **Unsubscribe-on-evict** — subscriptions accumulate per connection (bounded by
  tables-touched); add only if real sessions show a long over-delivering tail.
- **OPFS full-index-rewrite fix** (`opfs_page_store.sync()` review item) — same files,
  independent change; keep it a separate PR.
- Other review.md findings (authorization, Dynamo consistency, action typing, etc.) are
  not part of this plan.

## Review.md findings closed by this plan

- "Store only the latest page image, or garbage-collect superseded versions" (M1)
- "Do not insert a tombstone and replacement page under the same primary key" (M1)
- "Replace per-page reconnect validation with a bounded/batched protocol" (M3–M5)
- "Filter realtime page diffs by the pages each browser can actually hold" (M4)
- `BrowserPageTracker` memory / `acknowledgePages` protocol (M6)
- "Open independent per-table OPFS stores in parallel" — the fallback/registration path
  (M5); the loader-seed path is unaffected.
