# Sync protocol redesign: per-client state, client interest, and transfer volume

Findings + recommendation for the review.md cluster around client/server data volume:

- "Filter realtime page diffs by the pages each browser can actually hold"
  (`database_durable_object_connection.ts:317`)
- "Replace per-page reconnect validation with a bounded/batched protocol"
  (`database_durable_object_connection.ts:228`)
- `BrowserPageTracker` O(browsers × cached pages) resident state
- Eager `attachKnownTables()` / whole-cache validation at cold open
- Adjacent: "Store only the latest page image" (`database_server.ts:473`) — the storage
  schema and the sync protocol constrain each other, so they should be decided together.

---

## 1. What we have today (verified against the branch)

Facts that matter for the design, with sources:

1. **Versions are already a single monotonic counter per Durable Object.** `_nextVersion()`
   bumps once per `writePages()` batch and stamps every page/tombstone row written in that
   batch; it cold-loads from `MAX(version)` over `database_table_pages`
   (`database_server.ts:119-121, 435-495, 614-628`). There is no per-table version, no
   change log, no cursor — but the global counter means "pages of table T changed since
   version V" is already expressible against the existing schema.
2. **Reconnect validation is per-page.** `ensureCacheIsUpToDate` sends
   `Map<tableId, Map<pageIndex, version>>` for *every cached page of every OPFS store*
   (`database_client.ts:158-166`); the server does one `readPage` point-read per entry
   (`database_durable_object_connection.ts:228-250`), inlines up to
   `cacheUpdateStalePageLimit = 1000` **full 4 KiB pages** per table (up to ~4 MB), then
   degrades to stale-index lists. Called at cold open and on every reconnect
   (`database_connection_manager.ts:253-255, 382-391`).
3. **The per-browser tracker exists to dedup fallback responses; its realtime use never
   shipped.** `BrowserPageTracker` keeps `Map<tableId, Map<pageIndex, "confirmed"|"pending">>`
   per browser, rebuilt from each `ensureCacheIsUpToDate`, promoted by `acknowledgePages`.
   Its only live consumer is `filterReadPages` on `executeAction` responses
   (`database_durable_object_connection.ts:139-149`); `clientMightHavePage` is dead code —
   `PagesChanged` today is filtered by table *access* only, and every changed page diff goes
   to every connection (`database_durable_object_connection.ts:317-332`).
4. **Lazy interest already half-exists.** Eager attach is documented as an optimization
   (`database_client.ts:284-306`); attach-on-miss (`database.ts:802-838`) and server
   fallback on missing pages/headers (`DatabaseActionRequiresServerError`,
   `TableNotAttachedError` → `executeActionViaServer`, `database_client.ts:341-345,
   940-944`) are the existing recovery paths. The realtime diff pipeline also already
   self-heals: a diff whose `previousVersion` doesn't match the local base tombstones the
   page for refetch-on-demand (`database_client.ts:582-593`), and a diff for a page the
   client lacks is silently skipped (`:577-578`).
5. **Fallback responses are full pages** (`readPages: Map<tableId, Map<pageIndex,
   {version, data}>>` + `fileSizesInPages`), deduped only by the tracker's confirmed set.

### Cost profile

| Cost | Scaling | Notes |
|---|---|---|
| Reconnect request bytes | O(all cached pages) | every (page, version) pair, every reconnect |
| Reconnect server CPU | O(all cached pages) point reads | `overLimit` doesn't even short-circuit reads today (review bug) |
| Tracker memory | O(browsers × cached pages) | JS `Map` entry ≈ 50–100 B ⇒ a 10k-page working set ≈ 0.5–1 MB *per browser*; DO memory limit is 128 MB |
| Realtime egress | O(connections × changed pages) | diffs, but a diff can approach 4 KiB; no page-ownership filtering |
| Client interest | everything ever cached | all OPFS stores opened + validated + (up to 115) attached at cold open |

---

## 2. Your proposal, analyzed

> Remove `ensureCacheIsUpToDate` and eager attach; on read of a non-attached file, fall
> back to the server, sending {tableId → latest seen version} plus a bloom filter of held
> page indexes; server returns query pages + bloom-matching pages changed since the
> version; server remembers per client {tables read, bloom filter} and filters realtime
> with it.

### What it gets right (three load-bearing ideas)

1. **Lazy interest.** Don't validate or attach tables the session isn't using. The
   codebase is already structured for this (fact 4 above) — this is the cheapest part of
   the proposal to realize.
2. **Version cursors instead of per-page version maps.** "Latest version I've seen for
   table T" collapses the O(pages) reconnect payload to O(tables), and the server can
   answer it with a range query instead of N point reads. This is the single highest-value
   move, and the review's own recommendation ("prefer a table/group generation or
   change-log cursor") points the same way. Note, though, that this does **not** require
   switching to a per-db-file version *number*: the cursor is a client-held watermark into
   the **existing global version sequence** (see §5), and the current schema already
   answers "changed since V" per table. A per-table counter would add dense/contiguous
   numbering (gap detection), but that property is already covered by WebSocket ordering +
   reconnect revalidation at the connection level and by exact `previousVersion` matching
   at the page level — not worth a persisted counter per table plus a migration.
3. **Server state should describe *interest*, not *contents*.** Filtering realtime by
   "which databases has this client read this session" is the right granularity shift.

### Where it breaks: the bloom filter

The false-positive problem you identified is worse than an inefficiency — it splits into
four distinct defects:

- **Dedup is unusable, and not just "sometimes".** To skip a page in a fallback response
  you need *certain presence*; a bloom gives *possible presence*. Worse than wasted bytes:
  if the server ever skipped on a false positive, the client's local retry
  (`executeActionWithTracking` re-executes locally after fallback,
  `database_client.ts:398-410`) would hit the same missing page, fall back again, get the
  same FP-skip — a livelock on that page. So, as you noted, fallback responses must always
  carry all accessed pages, i.e. the bloom buys nothing on the request/response path.
- **Realtime filtering via bloom is safe but only in one direction.** No false negatives
  ⇒ a held page is never wrongly filtered out; false positives ⇒ wasted sends the client
  ignores. Tolerable — but the filter goes stale: blooms don't support deletion (evicted
  pages stay "held" forever) and can't be incrementally maintained as the cache grows
  without re-sending. Squid's cache digests — the canonical deployment of exactly this
  idea — rebuilt from scratch hourly because deletion was unsupported, and the planned
  incremental deltas were never implemented
  ([Summary Cache](https://www.eecs.harvard.edu/~michaelm/postscripts/im2005b.pdf),
  [Squid FAQ](https://wiki.squid-cache.org/SquidFaq/CacheDigests)).
- **It reintroduces the per-client state you're trying to delete** — smaller, but still
  per-client, still needing lifecycle management, and now *approximate*, so it can't ever
  be promoted to a correctness-bearing role.
- **It's dominated in this domain.** SQLite page indexes are *dense small integers*
  (0..fileSize, ≤ 262,144). A bloom at 1% FPR costs ~9.6 bits/element regardless of
  universe; a plain bitset costs 1 bit per universe slot. A 1,000-page (4 MB) table is a
  **125-byte** exact bitset; the 1 GiB worst case is 32 KiB, and run-length/compressed
  bitmaps (Roaring, or [Splinter](https://github.com/orbitinghail/splinter-rs), built
  specifically for SQLite page-index sets) shrink typical holdings far below that.
  Break-even density is ~10%: below that a Roaring array container (2 B/element, exact)
  still beats the bloom. Bloom filters win only for wide elements (URLs, hashes) over huge
  universes — the opposite of this workload.

**Conclusion: keep ideas 1–3, drop the bloom.** Anywhere the design wants "the set of
pages the client holds", an exact compressed bitmap is smaller *and* exact. But the deeper
result of the prior-art survey is that you mostly don't need to ship the held-set at all.

---

## 3. Prior art (condensed; details and URLs in §7)

The pattern across every system that scaled this problem:

1. **The client holds the cursor; the server holds nothing per client.** Graft (per-volume
   LSN), Turso/libSQL embedded replicas (generation + frame no.), LiteFS (TXID + rolling
   checksum), ElectricSQL (shape handle + offset), Cloudflare D1 read replication
   (bookmark), CouchDB (`_changes?since=seq`), Kafka (consumer offsets). The universal
   escape hatch for a cursor older than the compaction floor is "full resync", not "server
   remembers more".
2. **"Client holds an arbitrary subset of pages" is solved client-side.**
   [Graft](https://github.com/orbitinghail/graft) — the closest existing system to Alpine's
   design (lazy partial replication of 4 KiB SQLite pages) — never tells the server which
   pages a client caches. Sync returns *metadata only*: the union bitmap of page indexes
   changed since the client's LSN. The client intersects with its cache, invalidates, and
   refetches only pages it actually reads. Turso's new sync engine independently converged
   on the same shape (client-held revision + roaring-bitmap page selectors + lazy page
   fetch).
3. **Per-client server-side content tracking is the known-expensive path.** Replicache's
   Row-Version strategy / Zero's CVRs — one server-side row per synced row per client
   group — is deliberately paid for *query-defined* subsets with permission semantics, and
   costs a dedicated CVR database, GC/TTL machinery, and sticky sessions. Alpine's problem
   (page subsets of a canonical DB) doesn't need query-level diffing, so it doesn't need to
   pay this. `BrowserPageTracker` is a small CVR; the proposal to bloom-compress it is a
   lossy CVR. Both are the pattern the field moved away from.
4. **Fan-out of full data to everyone is the specifically-repudiated design.** Carl Sverre
   built SQLSync (full page-log fan-out to every client), then abandoned it for Graft with
   the stated reason that replicating the whole change stream to every client is "poorly
   suited to the constraints of edge and browser environments"
   ([Stop syncing everything](https://sqlsync.dev/posts/stop-syncing-everything/)).
5. **Games/pub-sub coarsen interest to topics** (area-of-interest, channels ≈ table
   files) and accept over-delivery within a topic; nobody filters broadcasts by per-client
   object sets at scale.

---

## 4. Design space

Four coherent options, in increasing distance from today:

**A. Patch the status quo.** Fix the `overLimit` read ordering; batch the per-page point
reads into one query per table; wire `clientMightHavePage` into `transformEvent`; bound
`ensureCacheIsUpToDate` input sizes. Keeps O(pages) reconnect payloads, O(browsers ×
pages) memory, and full-cache interest. This is treading water — the review findings
remain structurally true.

**B. Your bloom proposal.** Lazy interest + per-table cursors (good), bloom-filtered
realtime and per-client {tables, bloom} state (weak, per §2). Fallback dedup impossible;
filter staleness unsolved; still per-client server state.

**C. B with exact page sets.** Replace the bloom with per-table compressed bitmaps.
Fallback dedup becomes *possible and exact* with one elegant rule: the server may skip
page X of table T iff the client's bitmap contains X **and** the server's current
`version(X) ≤` the client's cursor for T (the client is current-through-cursor, so its
copy of any unchanged held page is the latest). No acknowledgement protocol, no
"pending/confirmed" tiers, no livelock. Bitmaps can be sent per-request (stateless server)
or cached per-connection (tiny: 125 B/table typical vs ~0.5–1 MB today). Realtime can be
filtered per-page exactly. Cost: the client ships bitmaps, and the server still carries
optional per-connection state.

**D. Per-table version cursors + table-level subscriptions; page sets stay client-side
(Graft-shaped).** The server never learns which pages a client holds:

- *Catch-up/validation:* client sends `{tableId → cursor}` for the tables it's about to
  use; server replies per table with `{changedPageIndexes: bitmap, fileSizeInPages,
  currentVersion, accessLevel}` — metadata only, O(changed) bytes. Client tombstones
  `changed ∩ held`, bumps its cursor, refetches lazily on read.
- *Realtime:* connections subscribe per table (the set of tables with open stores/queries
  — bounded by the attach ceiling of ~115–125). `PagesChanged` diffs are filtered by
  subscription, not by page ownership; within a subscribed table, diffs for un-held pages
  are skipped client-side exactly as today (`database_client.ts:577-578`). Each applied or
  skipped event advances the table cursor (WebSocket ordering makes this sound; gaps only
  at disconnect, which is what re-validation covers).
- *Fallback:* unchanged shape (`executeActionViaServer` returns full readPages), with
  dedup handled by option C's rule *only if profiling shows resends matter* — the client
  can attach bitmaps for the action's target tables to the request, keeping the server
  stateless.
- *Per-client server state:* `Set<tableId>` per connection. `BrowserPageTracker` and
  `acknowledgePages` are deleted.

D strictly subsumes the good parts of B/C and matches the validated pattern (§3). C's
bitmap-dedup rule is a compatible bolt-on to D, not a competing design.

---

## 5. Recommended design (D, concretely)

### Protocol

Replace `ensureCacheIsUpToDate` with two operations:

```
subscribeTables(request):
  tables: Map<DatabaseTableId, {cursor: number}>        // cursor = 0 for "no cache"
subscribeTables(response):
  tables: Map<DatabaseTableId, {
    status: "current" | "changed" | "resync",           // resync: cursor below tombstone horizon
    changedPageIndexes: CompressedBitmap,               // empty unless "changed"
    currentVersion: number,
    fileSizeInPages: number,
  }>
  tableAccess: DatabaseTableAccessLevels                // unchanged semantics

unsubscribeTables(tables: Array<DatabaseTableId>)       // on detach/eviction/close
```

Client-side rules:

- A table's cached pages must not serve reads until its cursor is validated on the current
  connection epoch (subscribe once per table per connection; batch the route's tables at
  cold open using the loader-seeded table IDs, subscribe others on first attach).
- On `"changed"`: tombstone `changedPageIndexes ∩ heldPages` (existing tombstone machinery,
  `database_client.ts:589, 602-604`), set cursor = `currentVersion`, apply
  `fileSizeInPages`. On `"resync"`: drop the table's OPFS store. On applying/skipping a
  realtime event for table T at version v: cursor(T) = v.
- Store the cursor in the OPFS per-table index (one integer next to the existing
  `fileSizeInPages`), replacing per-page versions as the *validation* currency — per-page
  versions stay, since diffs still key on exact `previousVersion`.

Server-side:

- `transformEvent` filters `PagesChanged` by the connection's subscription set (plus the
  existing access check); the empty-confirmation path to the originator is preserved
  unconditionally so the optimistic queue still dequeues on `mutationId`
  (`database_durable_object_connection.ts:124-137` semantics unchanged).
- **No new version scheme.** Cursors are watermarks into the existing per-DO global
  counter; `currentVersion` in the response is simply the global version as of the
  snapshot the changed-set was computed at. Answering "changed since V" for table T:
  `SELECT page_index FROM database_table_pages WHERE sqlite_id = ? AND version > ?`
  (dedup to latest). Add an index on `(sqlite_id, version)` — or accept an O(live pages)
  scan per subscribed table per reconnect, which already beats today's O(cached pages)
  point reads. A derived in-memory `maxVersion(tableId)` map (maintained on write,
  recovered via per-table `MAX` on cold load) gives an O(1) `"current"` fast path; an
  in-memory ring of `(version → changed bitmap)` per table (Graft's segment metadata) is a
  later optimization if reconnect storms show up.
- **Client watermarks are per-table even though the version space is global.** Advance
  cursor(T) only on applied/skipped events *for T* and on validation responses for T.
  cursor(T) lagging the global counter while T is quiet is harmless (revalidation returns
  an empty diff). A single group-wide client cursor is wrong under lazy interest: tables
  validated at different times legitimately hold different watermarks — a too-new group
  cursor silently skips a stale table's changes, a too-old one spuriously invalidates
  fresh tables.

### Interaction with the storage-growth fix (review: `database_server.ts:473`)

The two changes want to land together, because the cursor query defines what compaction
must preserve:

- Collapse to latest-image-per-page: PK `(sqlite_id, page_index)`, upsert `{version,
  data}`. The cursor query still works — each live page's `version` is its
  last-modified stamp.
- **Tombstones become protocol-relevant.** A truncated/deleted page must keep its NULL row
  (with its deletion version) so "changed since V" reports deletions; otherwise a stale
  client never learns a page died. Either retain tombstones indefinitely (rows are ~tens
  of bytes once data is NULL) or GC them past a per-table `tombstoneHorizonVersion` and
  answer `"resync"` for cursors below it — the standard log-compaction + snapshot-fallback
  contract (libSQL `NeedSnapshot`, Electric `409 must-refetch`).

### What each goal gets

| Goal | Mechanism | Before → after |
|---|---|---|
| No per-client page lists | delete `BrowserPageTracker`; per-connection `Set<tableId>` | ~0.5–1 MB/browser → ~1 KB/connection |
| Interest = tables in use | subscribe-on-attach, validate-on-first-use, unsubscribe-on-evict | all cached tables → open tables only |
| Reconnect transfer | O(tables) cursors up, O(changed) bitmap down | O(all cached pages) both ways, up to 4 MB inlined pages per table |
| Realtime transfer | subscription-filtered diffs | every changed page to every access-holding connection |
| Fallback transfer | unchanged; optional exact bitmap dedup (C's rule) | tracker-deduped today — measure before adding the bitmap |

The trade being made, explicitly: a client that was offline during changes pays one extra
round trip per invalidated hot page on next read (tombstone → read miss → fallback),
instead of receiving speculative page data up front. Graft accepts the same trade and
mitigates with prefetch; Alpine's mitigation already exists — the fallback response
carries the whole read-set of the query, so one round trip heals the whole b-tree path,
and SSR loader seeding covers the first paint. The `"changed"` response could optionally
inline data for ≤N changed pages (a smarter `cacheUpdateStalePageLimit`) if reconnect
latency on active grids measures badly; start without it.

### Rollout

The branch is pre-merge and the backwards-compatibility review already mandates a
versioned protocol handshake for other reasons (`TableMetadataChanged`, action shapes).
Folding this in *now* is materially cheaper than after GA: `ensureCacheIsUpToDate`,
`acknowledgePages`, and the tracker are all connection-scoped with no persisted server
state, so the swap is a protocol version bump, not a data migration. The only persisted
client change is one cursor field in the OPFS index (absence ⇒ cursor 0 ⇒ table
re-validates as `"resync"`/full-stale, which is safe).

---

## 6. Is this even important?

Ranked honestly against the rest of review.md:

- **More urgent than this:** the security findings (policy replacement, missing loader
  auth) and the unbounded page-version retention — those are merge-blockers regardless.
- **This cluster is real, though, and two parts of it bite early:** (1) tracker memory —
  a 128 MB DO hosting a few dozen browsers with multi-thousand-page working sets is a
  plausible OOM, and it fails as a *group-wide* outage; (2) reconnect validation — a
  deploy or DO restart reconnects every client simultaneously, each sending its full page
  map for O(pages) synchronous point reads on a single-threaded DO. Broadcast fan-out is a
  steadier tax (connections × changed pages) that grows with adoption.
- **The strongest argument for doing it now is sequencing, not load:** the fix wants a
  protocol version bump and a storage-schema decision, both of which are already forced by
  other review findings. Deferring it means paying the compatibility machinery twice and
  shipping a per-client-state protocol that prior art (§3) says you'll walk back.

Alternative framing worth stating: you could decide OPFS is a *best-effort read-through
cache* rather than a synced replica — only actively-viewed tables get realtime, everything
else is validate-on-use, and "how fresh is my cache" stops being a global invariant. The
cursor design quietly implements this stance (passive tables just have unvalidated
cursors), so you get to defer the philosophical choice; but if you embrace it fully, even
per-table subscriptions for *non-visible* tables can be dropped, shrinking realtime work
further.

## 7. Prior-art reference table

| System | Version unit | Server per-client state | Client expresses "what I have" | Delta delivery | Partial replication |
|---|---|---|---|---|---|
| [Graft](https://github.com/orbitinghail/graft) ([design](https://graft.rs/docs/internals/)) | LSN per volume (≈ table file) | none (commit idempotency keys only) | one LSN per volume | pull: changed-page **bitmap** (Splinter), metadata only; data fetched lazily on read | yes — core feature |
| [PowerSync](https://docs.powersync.com/architecture/powersync-protocol) | op_id per bucket + global checkpoint | ~none (one write-checkpoint counter per client) | bucket list + last op_id + per-bucket **checksum** | push ops over stream after `checkpoint_diff` | bucket-level |
| [Replicache row-version / Zero CVR](https://doc.replicache.dev/strategies/row-version) | per-row versions | **O(client-view rows) CVR** per client group | opaque cookie → CVR lookup | server-computed per-client diff | query-level (the expensive way) |
| [ElectricSQL](https://electric.ax/docs/guides/shapes) | offset per shape log | none | shape handle + offset (GET params) | pull/long-poll log suffix; CDN collapses fan-out | shape-level |
| [Turso embedded replicas](https://docs.turso.tech/features/embedded-replicas/introduction) | generation + frame no. (new: revision) | none | client-persisted cursor; new engine: + roaring page selector | pull frames/pages; `NeedSnapshot` past compaction | new engine: lazy page fetch |
| [LiteFS](https://fly.io/docs/litefs/how-it-works/) | TXID + rolling whole-DB checksum | per-connection only | `TXID/checksum` (16 bytes) | push LTX page sets to full replicas | no |
| [D1 read replication](https://blog.cloudflare.com/d1-read-replication-beta/) | bookmark (Lamport) | none | bookmark threaded through requests | replica blocks until caught up | no |
| [CouchDB](https://docs.couchdb.org/en/stable/replication/protocol.html) | db `update_seq` | none (checkpoints are client-written docs) | `since=seq` | pull `_changes` suffix | filtered replication — the cautionary tale (O(feed) filter per client) |

Algorithmic side notes: exact set reconciliation (IBLT
[Eppstein et al. 2011](https://people.cs.georgetown.edu/~clay/classes/fall2017/835/papers/IBLT.pdf),
[Minisketch/Erlay](https://github.com/bitcoin-core/minisketch),
[rateless IBLT 2024](https://arxiv.org/abs/2402.02668)) is built for peer-to-peer settings
with no authoritative log and huge sets with tiny diffs; with an authoritative versioned
server and 1–8 KB exact bitmaps, it buys nothing here. Bloom-filter cache summaries
([Summary Cache](https://www.eecs.harvard.edu/~michaelm/postscripts/im2005b.pdf),
[Squid digests](https://wiki.squid-cache.org/SquidFaq/CacheDigests)) are the deployed
precedent for the bloom idea and their operational history (no deletion, hourly rebuilds,
staleness in both directions) is the argument against it.

## 8. Revised recommendation (after discussion): fallback-registered subscriptions

Design D assumed an explicit `subscribeTables` call, but the client cannot enumerate its
interest up front — which tables an action touches depends on the schema, which lives in
the tables. The revision derives subscriptions from server-observed read-sets instead, and
adopts option C's exact bitsets server-side as a memory-for-latency trade:

- **Cold start does nothing.** No stores validated, no tables attached. The first action
  hits `TableNotAttachedError` and falls back.
- **Fallback = registration.** The fallback request carries `{tableId, heldPagesBitset,
  watermark}` for **every cached-but-unregistered table** (not just the action's target —
  the client can't predict join fan-out; the set shrinks to empty as the session warms
  up). The server executes the action; every table the action read becomes a subscription
  for this connection. The response carries the action's read pages (deduped by the rule
  below), plus inline catch-up for newly registered tables: data for
  `changed-since-watermark ∩ bitset`, new watermarks, `fileSizeInPages`, `tableAccess`.
- **Dedup rule** (from option C): skip page X of table T iff the *request's* bitset
  contains X **and** server `version(X) ≤` the request's watermark for T. Dedup must only
  consult client-sent bitsets — never the server's drifted copy — or an evicted page
  livelocks like the bloom false-positive case.
- **Server state:** per connection, `Map<tableId, bitset>` + watermark. Maintained as a
  **superset**: replaced when the client sends a fresh bitset, OR-ed when the server sends
  pages, never subtracted. Superset staleness only ever over-sends (client skips diffs
  with no base — existing behavior). ~125 B/table typical vs ~50–100 B/page today.
- **Realtime** filtered by subscription and bitset, with three carve-outs: (1) the
  originator's own mutation is never bitset-filtered (or its write-set is OR-ed in at
  commit) — the writer's optimistic pages may be absent from the server's copy and
  filtering them puts a refetch on the just-edited row; (2) when all of a table's diffs
  filter out, still send a `{version, fileSizeInPages}` stub — file size must stay
  current on a sparse cache, and it keeps watermarks from lagging; (3) `previousVersion
  === 0` diffs (new pages) should be *applied against a zero base* client-side instead of
  skipped, eliminating the read-miss round trip for the commonest realtime case (row
  insert → page append/split). Today's client skips them (`database_client.ts:577-578`),
  which is why new rows already cost a refetch.
- **The unregistered-table gate (load-bearing invariant):** a cached table must not serve
  local reads until registered on the current connection epoch. Otherwise a table cached
  last session but not yet touched this session serves stale data silently — it was never
  subscribed, so its realtime is filtered. Concretely: attach-on-miss becomes
  attach-after-register. The cost — one round trip on first touch of each cached table,
  even when fully cached — is the true price of deleting `ensureCacheIsUpToDate`, and is
  identical to D's validate-on-first-attach.
- **Reconnect** is re-registration: the client already knows its interest set, so it sends
  the same `{tableId, bitset, watermark}` payload for subscribed tables in one batch,
  rehydrating the server's in-memory view and receiving inline catch-up. This replaces
  `ensureCacheIsUpToDate` with O(tables × bitset) up / O(changed ∩ held) down.
- **Prerequisite:** SSR loader seeds must carry a per-table snapshot version so watermarks
  initialize; per-page versions alone leave a seeded table at watermark 0, degenerating
  its first registration to "everything changed".
- **Graft-style escape hatch:** keep bitsets + watermarks in the request shape regardless.
  If per-connection memory ever matters more than the round trip, the server can stop
  retaining bitsets and downgrade realtime to table-level filtering (or version-bump
  notifications) without a protocol change — the retained-state decision stays server-
  internal.

Versus §5's D: same cursors, same lazy interest, same deletion of `BrowserPageTracker`
and `acknowledgePages`; adds exact per-connection bitsets (small, reconstructible,
correctness-free — losing them only costs bandwidth) to buy back the reconnect and
realtime round trips D traded away. Realtime in both designs is push; the difference is
bandwidth on un-held pages, not round trips.

## 9. Open questions

1. **Cursor advancement on skipped diffs.** Advancing cursor(T) on an event whose diffs
   were all skipped (no held bases) is correct only if events for T are delivered in
   version order per connection — true today via `sendEventToAll` over one WebSocket, but
   worth a protocol-level assertion/test.
2. **Subscription ⇄ permission interplay.** Access revocation must now also drop the
   table from the connection's subscription set (today revocation only filters
   `transformEvent`). The `TableMetadataChanged` handler is the natural hook; the
   join-table derived-access review finding (`database_durable_object_connection.ts:341`)
   applies here too.
3. **Multi-tab worker.** Subscriptions are per WebSocket connection but the shared worker
   multiplexes tabs; the subscription set is the union of open tables across tabs, and
   unsubscribe needs refcounting in `DatabaseConnectionManager`.
4. **Subscription growth within a connection.** §8 has no unsubscribe: a connection's
   subscription set accumulates every table its actions ever read this session (bounded
   by tables-touched, and client-side LRU eviction doesn't unsubscribe — evicted tables
   just over-receive diffs the client skips). Likely fine; add unsubscribe-on-evict only
   if a real session shows a long tail of once-touched tables paying realtime bandwidth.
5. **Checksum hardening (optional).** A LiteFS-style incremental whole-table checksum
   (`XOR of crc64(pageIndex, data)`) would let `subscribeTables` *prove* cache/server
   agreement in 8–16 bytes and catch divergence bugs (e.g. the tombstone/index-rewrite
   family of client cache bugs) instead of trusting the cursor. Cheap to maintain on both
   sides; consider once the base protocol is in.
