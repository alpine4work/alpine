# Turso (libSQL) vs Alpine Databases: Architecture Comparison

_Assessed: February 2026. Turso repo: [tursodatabase/libsql](https://github.com/tursodatabase/libsql)._

---

## Executive Summary

Turso and Alpine Databases are more architecturally similar than SQLSync was — both use WAL frames
as the sync primitive, both use a canonical server with local read replicas, and both use a delta
sync / snapshot fallback strategy. Turso has already solved the hard WAL invariant problems Alpine
is worried about (frame injection, checksum chain management, generation/salt handling). It cannot
be used as a drop-in because it has no optimistic write model and is not designed for browser WASM,
but it is the closest existing reference implementation for Alpine's sync layer and its libSQL WAL
methods interface is directly relevant to Alpine's custom build.

---

## What Turso Is

Turso is a hosted SQLite service built on **libSQL**, a fork of SQLite's C source with several
extensions:

- **Pluggable WAL interface.** libSQL replaces SQLite's internal WAL implementation with a
  registered virtual WAL (`libsql_wal_methods_register`). Custom WAL backends can intercept frame
  reads/writes, enabling replication, S3-backed storage ("Bottomless WAL"), encryption, and
  compression.
- **Embedded replicas.** A local SQLite file on the client syncs from the primary via WAL frame
  streaming. Reads are local (sub-microsecond); writes are forwarded to the primary by default.
- **Frame streaming protocol.** The replication layer (written in Rust) streams WAL frames from
  primary to replicas over gRPC. Replicas connect with their last known frame number and generation
  ID; the primary sends the delta or a full snapshot if the replica is too far behind.
- **Frame injection.** A `SqliteInjector` component applies received WAL frames directly into the
  replica's SQLite WAL, bypassing SQL re-execution entirely.
- **Generation IDs.** WAL resets (equivalent to Alpine's "salt change on checkpoint") are tracked
  via a generation ID that increments on primary restarts. Replicas use this to detect when they
  need a snapshot rather than a delta.
- **Offline writes (beta).** Local writes to the replica are captured in the SQLite WAL and pushed
  to the primary on reconnection, with configurable conflict resolution strategies.

---

## Side-by-Side Comparison

| Dimension | Alpine Databases | Turso (libSQL) |
|---|---|---|
| **Sync primitive** | WAL frames | WAL frames |
| **Wire format** | WAL frames (or page diffs — TBD) | WAL frames over gRPC |
| **Delta sync** | Yes, by frame number | Yes, by frame number |
| **Snapshot fallback** | Yes, when outside retention window | Yes, when replica is too far behind |
| **Reads** | Local SQLite | Local SQLite |
| **Writes (default)** | Optimistic local execute → server confirm → rebase | Forward to primary, wait for confirmation |
| **Optimistic concurrency** | Core feature; local execute + rebase loop | Not present in standard mode |
| **Frame injection** | Needed; not yet built | Solved (`SqliteInjector`) |
| **Checksum chain** | Identified as hard problem | Solved |
| **Salt / generation tracking** | Identified as hard problem | Solved (generation IDs) |
| **WAL hooks interface** | Needs custom build | Solved (`libsql_wal_methods`) |
| **Checkpoint control** | Needed; not yet built | Solved |
| **Offline support** | Non-goal | Beta feature |
| **Browser / WASM target** | Primary target | Not a target |
| **Shared web worker** | Yes | No |
| **Language** | TypeScript + custom C WASM build | C (SQLite fork) + Rust replication |
| **Multi-user realtime** | Core feature | Not designed for it |
| **Conflict resolution** | Rebase (re-execute SQL on new base) | FAIL / DISCARD / REBASE / MANUAL (offline only) |

---

## Where They Agree

**The sync primitive.** Both use WAL frames as the unit of replication. This is a meaningful
validation that the approach is sound at scale — Turso is in production.

**Delta + snapshot.** Both use the same strategy: stream frames if the replica is within the
retention window; send a full snapshot otherwise. Turso proves this heuristic works in practice.

**Reads are always local.** Same model. Turso measured sub-microsecond read latency from embedded
replicas.

**Server is canonical.** Both designate a single primary as the source of truth. Client state
converges toward the primary's committed frame sequence.

**The WAL invariant problems are the same.** Checksum chain, generation/salt tracking, frame
injection into a live SQLite WAL — Turso encountered and solved exactly these problems. The
solutions are in libSQL's open-source C and Rust code.

---

## Where They Diverge

### 1. Optimistic writes — the core gap

This is the fundamental functional difference. Turso's write model:

1. Client sends write to primary
2. Client waits
3. Primary commits, streams frames back
4. Client applies frames

There is no local execution, no optimistic state, no rebase loop. The UI blocks on network
round-trips for writes. For Turso's use cases (edge databases, read-heavy apps) this is fine.

Alpine's write model requires:

1. Execute SQL locally → instant UI feedback
2. Send SQL to server concurrently
3. Server commits → streams back frames
4. Client reverts local optimistic frames, applies server frames
5. If intervening commits arrived: rebase (revert + re-execute SQL on new base)

This entire layer does not exist in Turso. It would need to be built on top.

### 2. Browser / WASM

Turso targets server-side runtimes and native clients (Node.js, Go, Rust, Python). libSQL's C
source assumes a standard POSIX environment. The shared-memory WAL methods (`xShmMap`,
`xShmLock`) are implemented for multi-process native use, not for the browser sandbox.

Alpine's exclusive-locking-mode approach (single connection, WAL index in heap memory) would need
to be ported from Turso's native assumptions. This is non-trivial but not a complete rebuild —
it's a porting problem within the C layer.

### 3. Language

libSQL is C + Rust. Alpine is TypeScript throughout. Turso cannot be imported or extended in
TypeScript — any adoption of Turso's approach means compiling libSQL's C to WASM and wrapping it
in a TypeScript API, which is what Alpine's "custom SQLite WASM build" plan already amounts to.

### 4. No shared web worker model

Turso has no concept of sharing a database across browser tabs. This is Alpine's explicit design
(single shared worker for all tabs on the same database).

### 5. Realtime multi-user collaboration

Turso's embedded replicas are pull-based — replicas sync when they call `sync()` or on a
configured interval. There is no server-push model for streaming new commits to connected clients
in real time. Alpine needs the server to push frames to all connected clients immediately after
each commit to support live collaborative editing.

---

## Drop-In Assessment

**Turso cannot be used as a drop-in.** The missing pieces are architectural:

| Requirement | Turso provides? |
|---|---|
| WAL frame sync primitive | Yes ✓ |
| Delta sync / snapshot fallback | Yes ✓ |
| Frame injection into client WAL | Yes ✓ |
| Checksum chain management | Yes ✓ |
| Generation / salt tracking | Yes ✓ |
| WAL hooks interface | Yes ✓ |
| Checkpoint control | Yes ✓ |
| Optimistic local writes | No |
| Rebase loop | No |
| Browser / WASM target | No |
| Shared web worker | No |
| Server-push realtime streaming | No |
| TypeScript implementation | No |

The bottom half of that table is Alpine's entire collaborative concurrency model — it's not
peripheral.

---

## What Turso Does Provide

Despite not being a drop-in, Turso is the most directly useful reference for Alpine's build:

**The hard WAL problems are solved in open source C.** Frame injection, checksum chain
continuation, generation ID handling, frame-level WAL hooks — all of this is in libSQL's source.
Alpine's custom WASM build should read libSQL's `wal.c`, `libsql_wal_methods`, and
`SqliteInjector` before writing a line of its own C.

**The `libsql_wal_methods` interface is exactly what Alpine needs.** Registering a custom WAL
backend with frame-level intercept hooks — this is Alpine's "thin C API extensions" requirement
from the vision doc, and Turso has already designed and implemented it. The interface can likely be
adopted directly or adapted into Alpine's WASM build.

**The replication protocol design is a direct reference.** Frame number tracking, generation IDs
as WAL-reset markers, delta streaming with snapshot fallback — Alpine should treat Turso's Rust
replication crate as a specification for its own protocol, not reinvent it.

**Turso validates the WAL frame approach.** The vision doc notes: "None of these projects have
attempted what we're doing." That's too strong. Turso uses WAL frames as a sync primitive in
production at scale. The frame injection and checksum chain problems are not unsolved research —
they are solved engineering in libSQL. The unsolved part is the optimistic concurrency and WASM
browser layers.

---

## Alternative Framing

Turso is what Alpine would look like without the optimistic concurrency model and without the
browser target. The gap between them is exactly the novel part of Alpine's design. Turso is not a
competitor to learn from cautiously — it is a proven foundation whose hard-won C solutions Alpine
should study and borrow directly.
