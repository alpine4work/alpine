# Code Review — `databases` (commits `7a3163f..HEAD`, 19 files, +1544/−909)

**Scope:** the rebuild of `DatabaseServer` on the shared `Database`, batched
`writePages(pages, truncates)` with a global version counter, `BrowserPageTracker` partitioned by
`DatabaseTableId`, the schema-name page-access hook, and the new `Database.attach()` + `"attach"`
authorizer level.

9 finder angles + a sweep, candidates verified against source, and `dev check` run as ground truth.
**The branch does not currently compile** — that's the headline.

## 🔴 Blocking — build is broken

**1. `shared/databases/database.ts:216` — authorizer callback param type is wrong; whole feature
fails to typecheck.** The callback is declared `(_cbArg, actionCode, actionArg: string | null)`, but
`sqlite3_set_authorizer`'s `xAuth` types each string arg as `string | 0` (SQLite passes the C null
pointer `0`, not `null`). Verified with bazel:

```
database.ts:216:13 - error TS2345: ... Type 'string | 0' is not assignable to type 'string | null'.
```

This fails `//shared/databases:databases_typecheck_test` and cascades to `//server/databases`,
`//client/web/databases`, and every dependent package (`112 tests fail to build`). Fix: type
`actionArg: string | 0` (or `string | number`) and normalize before `isSqliteActionAllowed` (e.g.
`typeof actionArg === "string" ? actionArg : null`) — note the `actionArg === ""` VACUUM check
downstream assumes a string.

**2. `shared/databases/sqlite_authorizer.test.ts:36` — stale 2-arg call to
`isSqliteActionAllowed`.** The signature changed to `(action, actionArg, writeLevel)` (3 required,
no defaults) but this untouched test still calls `isSqliteActionAllowed(action, writeLevel)`. It's
currently _masked_ because the lib (#1) fails to build first; once #1 is fixed this surfaces as
`TS2554: Expected 3 arguments, but got 2` and blocks `databases_tests_typecheck_test`. The test's
own authorizer wiring also needs the real arg threaded through. Fix both call sites together.

## 🟠 Correctness

**3. `server/databases/database_server.ts:195` — the buffer drain runs _outside_ `_runAndPersist`'s
try/catch, so a storage failure during persist permanently wedges the instance.** The `catch` at
line 189 wraps only `database.execute`; `_persistAndBuildResult` → `_persistBuffer` →
`storage.writePages` (line 238) runs after the try. If `storage.writePages`/`readPage` throws
(quota, SqlStorage error), `discardBuffer()`/`markCommitted()` never run, leaving a non-empty
buffer. The DO's `transactionSync` rolls back SQL rows but **not** the in-memory `Database` buffer,
so the next `execute` hits `assertBufferIsEmpty("_runAndPersist")` (line 167) and throws forever —
every subsequent action on that database is dead until the DO restarts. Fix: include the persist in
the try (discard buffer on any failure).

**4. `server/databases/database_server.ts:215` — `changedPages` is built only from `buffered.pages`,
silently dropping truncate-only tables, contradicting its own comment.** The comment at lines
209–212 promises coverage of "every table with a buffered truncate (which can change file size
without buffered pages)," but the loop iterates `buffered.pages` only. A table with a buffered
truncate and zero buffered page writes is in `buffered.truncates`/`fileSizesInPages` but never
enters `changedPages`, so its shrunk `fileSizeInPages` is never broadcast (the realtime layer
iterates `result.changedPages`). Latent today because VACUUM rewrites the header page on `main`, but
reachable for an attached table that shrinks without dirtying a page — peers keep stale trailing
pages. Fix the loop to also visit `buffered.truncates`, or correct the comment.

**5. `server/databases/database_durable_object_connection.ts:205` — `acknowledgePages` forwards
arbitrary client-supplied `tableId`s into the tracker, enabling unbounded per-browser memory
growth.** Old code constrained acks to one table
(`input.pageIndexes.get(databaseMainTableId) ?? []`); the new code passes the whole
`Map<DatabaseTableId, Array<number>>` to `addPages`, which calls `_getOrCreateTable` for every key.
A buggy/malicious client can send thousands of fabricated `tableId`s and grow the DO's per-browser
`pages` map without bound. Validate keys against attached tables before adding.

**6. `server/databases/browser_page_tracker.ts:709` — `setPages` is a full all-tables replacement,
but `ensureCacheIsUpToDate` only ever passes the main table, wiping tracker state for attached
tables.** `setPages` clears entries for tables absent from `pagesByTable`. `ensureCacheIsUpToDate`
calls it with `new Map([[databaseMainTableId, matchingPages]])`, so any confirmed/pending pages for
attached tables are dropped on every cache-validation round;
`clientMightHavePage(b, attachedTableId, …)` then returns false and `transformEvent` filters out
their diffs. Latent until attached-table sync is wired through the DO connection, but the partition
contract is already violated.

**7. `server/databases/database_server.ts:257` — a page read then truncated-away in the same batch
is reported in `readPages` as a zero-filled, version-0 page.** For a non-changed read page, the
after-drain re-read (`storage.readPage`) returns `null` after the batch's truncate tombstones it,
yielding `{data: zeros, version: 0}`. If `returnPages` is set, the client gets a bogus page for an
index the server considers gone. Narrow trigger (read+truncate same page in one statement) and
partly gated by the client's `writePageIfNewer` version check, but the pre/post-drain read ordering
differs from the old transaction-scoped capture.

## 🟡 Efficiency (hot paths)

**8. `server/databases/database_durable_object_storage.ts:88,131` — per-row work on the
write/truncate path.** The truncate path runs `SELECT DISTINCT page_index … >= ?` then one
`INSERT … NULL` per row; `_persistAndBuildResult` issues one `storage.readPage` per changed page for
before-images. Both scale linearly with page count via separate SqlStorage round-trips. Batch the
tombstone insert (`INSERT … SELECT …`) and the before-image reads (`… page_index IN (…)`).

**9. `shared/databases/database.ts:~398` + `admin/patches/bazel/sqlite.patch` (OO1 wrapper) —
per-page-read overhead.** The hook now does `wasm.cstrToJs(zSchemaPtr)` (allocates a JS string)
_and_ `schemaToTable.get(schemaName)` (string hash) on **every** page read, where the old hook used
an ignored integer `pArg`. For the common no-ATTACH case this hashes the constant `"main"` per page.
Consider memoizing by pointer value or short-circuiting the single-table case.

## 🔵 Cleanup / reuse

**10. `shared/databases/sqlite_test.test.ts` — byte-identical duplicate of
`sqlite_page_access_hook.test.ts`.** Verified identical (`diff` reports no difference; same git
blobs). `ts_project()` auto-registers both, so the suite runs twice, and this very commit had to
apply every hunk _twice_. Delete `sqlite_test.test.ts`; keep the descriptively-named one.

**11. `server/databases/database_durable_object_connection.ts:242` — `transformEvent` emits an entry
for every changed table even when all its diffs were filtered out.** The client then runs
`setServerFileSizeInPages` + `sync()` per empty entry (wasted OPFS work; skipped only when it has no
store). Guard with `if (tableFiltered.size > 0)`, mirroring `filterReadPages`'s `if (out.size > 0)`.
(Relatedly, the `if (pages.size === 0) continue` at line 91 is dead — `getBufferedWrites` never
produces an empty `pages` entry.)

**12. `server/databases/browser_page_tracker.ts:833` (`_getOrCreateTable`) and
`shared/databases/database.ts` (`addToTablePageSet`) reimplement `getOrSetDefaultMapValue`** from
`shared/helpers/map/` (both packages already depend on `//shared/helpers`). The new
`writePagesFor`/`truncateFor`/`noTruncates` test helpers are also duplicated byte-for-byte across
`database_durable_object_storage.test.ts` and `database_durable_object_connection.test.ts` — extract
to a `server/databases/test_helpers` package (the repo's established convention).

## ⚪ Altitude

**13. `shared/databases/database.ts:402` — `attach()` failure handling is incomplete and the design
rests on un-enforced contracts.** If `sqliteAttachPagePragma` throws _after_ `ATTACH` succeeds, the
catch deletes the `tables` entry but the schema stays attached in SQLite — now untracked,
un-detachable (authorizer bans `DETACH`), and a retry hits "already attached," wedging that
`tableId`. More broadly: the "re-install the hook after every ATTACH" rule and the `schemaToTable`
map (never pruned, no `detach()`) are manual contracts whose safety currently depends entirely on
the authorizer ban + VACUUM's specific behavior. The `actionArg === ""` VACUUM detection
(`sqlite_authorizer.ts:107`) also rides on an undocumented SQLite internal that no test pins. Worth
an explicit assertion/test rather than convention.

---

## Discovered during remediation

**R1 (NOCOMMIT). `server/databases/database_durable_object_connection.ts` `transformEvent` —
realtime diff filtering fails closed, causing silent client cache divergence on reconnect / DO
eviction.** `BrowserPageTracker` is in-memory and per-DO; a browser's entry is deleted when its last
connection closes (`browser_page_tracker.ts:58-60`) and lost entirely on DO eviction/restart. The
client's OPFS cache persists across all of that, and `ensureCacheIsUpToDate` runs only once per
client creation (memoized in `database_active_tab_manager.ts:211-224` — reconnect paths only
re-register watches, not the resync). So after a reconnect the tracker under-estimates what the
client holds, `clientMightHavePage` returns `false` for genuinely-cached pages, and their
`PagesChanged` diffs are dropped rather than applied → stale OPFS, surfaced as stale local query
reads.

The tracker is only a bandwidth optimization, and its error directions are asymmetric:
over-estimating is harmless (the client skips diffs for pages it lacks via `base === null`),
under-estimating diverges. So the correct posture is **fail-open** (unknown → send the diff). Fix
options (decision pending): (a) fail-open in `clientMightHavePage`/`transformEvent` — small, closes
the divergence immediately; (b) re-run `ensureCacheIsUpToDate` on reconnect to restore per-page
filtering (larger: must handle a warm pager cache + in-flight optimistic mutations, since the
current resync is cold-startup-only). Marked with a `NOCOMMIT` at the divergence site. Also worth
questioning whether the `clientMightHavePage` gating earns its keep at all, given it carries the
correctness risk for the smaller of the two optimizations.

---

## Verdict

Items **#1–#2 must be fixed before this can merge** (it doesn't build). **#3** (permanent wedge) and
**#5** (client-driven unbounded growth) are the highest-value runtime fixes; **#4** is a real
comment/code contract violation that's latent only by luck. The efficiency and cleanup items are
non-blocking.
