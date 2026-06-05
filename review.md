# Code Review — `databases` (commits `7a3163f..HEAD`, 19 files, +1544/−909)

**Scope:** the rebuild of `DatabaseServer` on the shared `Database`, batched
`writePages(pages, truncates)` with a global version counter, `BrowserPageTracker` partitioned by
`DatabaseTableId`, the schema-name page-access hook, and the new `Database.attach()` + `"attach"`
authorizer level.

9 finder angles + a sweep, candidates verified against source, and `dev check` run as ground truth.
**The branch does not currently compile** — that's the headline.


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

## Verdict

Items **#1–#2 must be fixed before this can merge** (it doesn't build). **#3** (permanent wedge) and
**#5** (client-driven unbounded growth) are the highest-value runtime fixes; **#4** is a real
comment/code contract violation that's latent only by luck. The efficiency and cleanup items are
non-blocking.
