# Alpine Databases: Technical Vision

> A realtime collaborative database platform powered by SQLite in the browser.

---

## Overview

Alpine Databases brings the power of SQLite to collaborative, multi-user applications by running it
natively in the browser via WebAssembly (WASM) — synced in realtime with a server-side counterpart.
Think Airtable or Notion databases, but with the full expressiveness of SQL and a sync architecture
designed from the ground up around SQLite's page-based storage model.

This document outlines the core technical ideas behind Alpine's architecture: how data flows between
clients and servers, how we handle conflicts and consistency, and what features we're working
toward.

---

## Core Architecture

### SQLite Everywhere

Alpine runs SQLite both in the browser (via WASM) and on the server. A **custom VFS (Virtual File
System)** on the client stores database pages in two layers:

-   **In-memory** — for fast, ephemeral access and optimistic writes
-   **OPFS (Origin Private File System)** — for persistent local storage

On the server, a corresponding custom VFS intercepts written pages, persists them to a backing
store, diffs the changes at the page level, and broadcasts the changed bytes to all connected
clients over WebSocket.

This page-centric approach is key — it lets us treat SQLite's internal storage as the unit of
replication, rather than trying to replicate SQL statements or application-level events.

---

## Realtime Sync

### Optimistic Writes

When a client executes a write:

1. The SQL is sent to the server _and_ executed immediately on the client (optimistically).
2. Optimistically written pages are held in memory, layered on top of the persisted state. All
   subsequent reads check this optimistic layer first.
3. On the server, writes are applied serially. The VFS captures the resulting page changes and
   broadcasts them as binary diffs over WebSocket to all connected clients.
4. When a client receives a broadcast, it applies the incoming page changes to its local state.
5. If the broadcast corresponds to one of the client's own pending optimistic writes, that write is
   removed from the optimistic queue.
6. Any remaining optimistic writes are **re-executed on top of the new server state** — analogous to
   a `git rebase`.

This model keeps the UI snappy while ensuring the server remains authoritative. Conflicts are
resolved naturally by the serial application order on the server.

---

## Reactive Queries

We plan to support live/reactive queries by tracking which pages are accessed during query execution
and invalidating those queries when relevant page changes arrive.

**Known challenges:**

-   SQLite's **page 1 contains the file change counter** and is touched on every write, which would
    cause excessive invalidation if used naively. We need a smarter heuristic or more granular
    tracking.
-   SQLite's **page cache** may prevent us from observing all page reads during a query. Disabling
    the cache is an option, but has performance implications. Another possibility is hooking into or
    patching the cache layer to intercept reads without fully disabling it.

Reactive queries are a high-leverage feature — rather than re-evaluating every query on every page
update, they allow us to only re-run queries that actually touch the changed pages.

---

## Partial Replication

Downloading an entire database to the client on first load is simple but potentially slow. Fetching
pages on-demand as SQLite requests them is even worse — SQLite reads pages sequentially, and each
missing page would require a round-trip, resulting in hundreds of sequential network requests.

Instead, Alpine uses a **query-driven prefetch** strategy:

1. When a query runs on the client, it executes against the local state.
2. The first time a **missing page** is encountered, the query is suspended and forwarded to the
   server.
3. The server re-executes the query, tracks all pages accessed, and returns the **query result** (or
   the first _n_ rows) along with **all accessed pages**.
4. Subsequent evaluations of that query — including realtime updates — run entirely client-side
   against the now-populated local page cache.

When rendering on the server, we can bundle the initial query results and their accessed pages
directly into the page response, eliminating the first-load round-trip entirely.

**Index management is a significant risk here.** If queries devolve into full table scans, they'll
pull in nearly every page anyway, negating the benefit of partial replication. This isn't something
we can leave to users — manually managing indexes is impractical and error-prone. It will be
Alpine's responsibility to programmatically create and maintain the right indexes based on observed
query patterns.

---

## History & Snapshots

The server-side backing store records every page version:

```
(page_number, timestamp, data)
```

Reading the current database means selecting the latest version of each page. Reading the database
**at any point in time** means selecting the latest version of each page _as of that timestamp_ —
making point-in-time snapshots a natural, first-class feature with no additional infrastructure. Old
versions can be pruned over time to reclaim storage, with configurable retention windows depending
on how much history a database needs to keep.

The choice of backing store is still TBD — one option is another SQLite database, which would keep
the operational footprint delightfully minimal.

---

## Offline Support

Full offline write support isn't a goal — the complexity of multi-user write conflict resolution
without a server is significant, and the use cases don't justify it. However, Alpine can
meaningfully improve resilience and performance by persisting pages in the browser long-term (via
OPFS):

-   Queries can be answered from the local cache even during brief network interruptions.
-   On reconnect, the client sends the last-seen timestamp for each locally cached page. The server
    responds with the latest versions of any stale pages, minimizing the data needed to catch up.

This gives us most of the UX benefit of offline-first without the full complexity of offline write
conflict resolution.

---

## Deterministic Execution

Because writes may execute multiple times — at least once on the client optimistically, once on the
server, and potentially again during optimistic rebases — queries involving randomness or time could
produce inconsistent results that appear to flicker.

Alpine addresses this by **controlling the VFS's time and randomness hooks**:

-   Each write transaction is assigned a **transaction ID**, used to seed a deterministic RNG.
-   The client's wall clock time is used for timestamp functions, provided it hasn't drifted
    significantly from the server.

This ensures that re-executing a write produces the same logical result regardless of when or where
it runs — reducing visible inconsistency during the optimistic window.

---

## Undo / Redo

Although Alpine has full page-level history, **physical rollback is not suitable for undo/redo in a
collaborative setting**. Rolling back pages after other users' changes have been applied risks
conflicts and corruption.

Undo/redo must be **logical** — recording the inverse operation for each user action, not the raw
storage state. This works well for structured UI operations (adding a row, updating a cell) but
becomes significantly harder for arbitrary SQL — particularly DDL operations like schema changes.

**Open problem.** Possible directions:

-   For schema-modifying SQL, require explicit snapshots rather than supporting undo.
-   Restrict undo/redo to UI-driven operations only and treat raw SQL as outside its scope.
-   Block schema changes via the SQL interface entirely, confining schema evolution to a controlled
    migration path.

This is an area where the right constraints need to be established before the mechanism is built.
