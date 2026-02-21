# Databases: Vision

Alpine Databases is a realtime collaborative database product (similar to Airtable, Smartsheet, or
Notion databases) powered by SQLite running in the browser via WASM.

The core technical insight is using **SQLite WAL (Write-Ahead Logging)** as the synchronization
primitive between a canonical server and connected clients. WAL gives us a structured, ordered log of
page-level mutations that we can stream, apply, and revert—making it the backbone of our optimistic
concurrency model.

## Architecture

### Server

A centralized server holds the canonical SQLite database for each user database. All committed writes
flow through the server, which:

1. Applies SQL writes to the canonical database.
2. Produces WAL frames as a byproduct of each transaction.
3. Streams those WAL frames to all connected clients in commit order.

The server is the single source of truth. Its WAL frame sequence defines the authoritative state of
the database.

### Client

Each client runs its own SQLite instance in WASM. On connection it receives a snapshot of the
database and then a continuous stream of WAL frames from the server.

#### Reads

Reads are always local. The client queries its own SQLite instance directly, so read latency is
effectively zero.

#### Writes (optimistic concurrency)

1. The client executes a SQL write against its local SQLite instance. This produces local WAL frames
   that are immediately visible to local reads (optimistic update).
2. The client sends the SQL command to the server for canonical execution.
3. **Success:** The server commits the write and streams back its WAL frames. The client reverts its
   local optimistic WAL frames and applies all the server's frames. The server always wins—even if
   no other commits intervened, the server's frames are canonical because SQL can be
   non-deterministic (`random()`, `now()`, trigger side effects, etc.) so the client's optimistic
   frames may differ from the server's actual result.
   - **Intervening commits:** While the client's write is in flight, other users' commits may arrive
     via the realtime stream. The client must revert its optimistic frames, apply the incoming server
     frames, then re-execute the original SQL command locally to produce fresh optimistic frames on
     top of the new base state. This "rebase" may need to happen multiple times before the client's
     own write is confirmed by the server.
4. **Failure:** The server rejects the write (constraint violation, permission error, etc.). The
   client reverts its local WAL frames, discarding the optimistic update.

The key property that makes this work: **WAL frames are revertible.** We can undo a local optimistic
write by discarding its WAL frames and restoring the prior database state, because the original pages
are still in the database file until a checkpoint moves them.

### WAL as the sync protocol

WAL frames are the unit of synchronization. They are compact (just the modified pages plus a small
header with checksums and page numbers), ordered, and self-describing. Streaming WAL frames from
server to client is essentially streaming a changelog of the database at the storage layer—below the
SQL abstraction.

This is intentionally lower-level than streaming SQL statements or row-level changes. Page-level
frames are:

- **Schema-agnostic.** The sync layer doesn't need to understand table schemas.
- **Complete.** They capture all side effects of a transaction (indexes, internal SQLite structures,
  etc.) with no gaps.
- **Compact.** Only modified pages are transmitted, not full snapshots.

## The WASM WAL problem

SQLite's official WASM build does not support WAL mode (except in exclusive locking mode, which
disables concurrency). This is our primary technical challenge.

### Why WAL doesn't work in WASM today

WAL mode requires the VFS to implement four shared-memory methods (`xShmMap`, `xShmLock`,
`xShmBarrier`, `xShmUnmap`). These manage the **WAL index** (the `-shm` file), a shared-memory
region that:

- Maps page numbers to their locations in the WAL file via a hash table, so readers can quickly find
  the latest version of any page without scanning the entire WAL.
- Coordinates concurrent readers and writers through lock bytes and read-marks.

On native platforms this is implemented via `mmap()` on a shared file. Browsers have no equivalent
primitive, so the official WASM build omits these methods entirely.

There is a second, deeper issue: SQLite's `wal.c` performs **direct pointer arithmetic** on the
shared memory returned by `xShmMap` using atomic load/store macros. These bypass the VFS abstraction.
On native builds they compile to atomic CPU instructions on memory-mapped regions. In WASM, the
pointers live in linear memory, which is fine for single-threaded access but would require custom
SQLite macro redefinitions for any multi-threaded scenario.

### Why this should be solvable for us

Our use case is fundamentally **single-threaded, single-connection**. Each client has exactly one
SQLite connection in one JavaScript thread. We don't need:

- Cross-process shared memory (no other process is accessing our database).
- Atomic instructions (no concurrent threads are touching the WAL index).
- Lock arbitration (there's only one reader/writer).

In this context:

- `xShmMap` can allocate regions in WASM linear memory (normal `malloc`).
- `xShmLock` can be a no-op or trivial bookkeeping (no contention possible).
- `xShmBarrier` can be a no-op (no other threads to synchronize with).
- `xShmUnmap` can free the allocated memory.

The atomic load/store macros in `wal.c` compile to plain memory reads/writes in single-threaded WASM,
which is correct behavior. No macro redefinition should be needed.

### What we need to build

A **custom SQLite WASM build** with a VFS that implements the `xShm*` methods for single-threaded
use. This means:

1. Compiling SQLite to WASM with `SQLITE_ENABLE_WAL` (or rather, not disabling it) and
   `sqlite3_io_methods` version 2+.
2. Writing a custom VFS (likely in C, compiled alongside SQLite) that:
   - Stores the database and WAL in memory (we receive state from the server, no need for persistent
     local storage).
   - Implements `xShmMap`/`xShmLock`/`xShmBarrier`/`xShmUnmap` as described above.
   - Exposes hooks to JavaScript for injecting server WAL frames and extracting local WAL frames.
3. Wrapping this in a JavaScript API that the rest of Alpine's client code can use.

The VFS also needs to give us **control over the WAL lifecycle** beyond what SQLite's public API
normally exposes. Specifically we need to:

- **Read WAL frames** produced by local writes so we can send them to the server (or at least send
  the SQL command).
- **Inject WAL frames** received from the server into the local database.
- **Revert WAL frames** from failed or rebased optimistic writes.
- **Control checkpointing** so we don't checkpoint past frames we may need to revert.

Some of this may require patching SQLite's WAL logic or adding thin C API extensions on top.

## Existing ecosystem

- **wa-sqlite** implemented WAL-like concurrency at the VFS layer (OPFSPermutedVFS) rather than
  using SQLite's actual WAL mode. Interesting engineering but a different approach from ours.
- **Official SQLite WASM (3.47+)** supports WAL in exclusive locking mode only, which uses heap
  memory for the WAL index. This proves the basic machinery works in WASM but doesn't give us the
  frame-level control we need.
- **cr-sqlite** supports WAL in native Node.js but not in browser WASM.

None of these projects have attempted what we're doing: using WAL frames as a synchronization
protocol. We are likely the first to need this specific capability.

## Expected difficulties

1. **Custom SQLite WASM build.** We need to compile SQLite ourselves with a custom VFS rather than
   using an off-the-shelf WASM distribution. This is a meaningful build infrastructure investment.

2. **WAL frame interception.** SQLite's WAL is an internal implementation detail, not a public API
   surface. Extracting frames after local writes and injecting server frames will require either
   patching SQLite source or carefully hooking the VFS layer.

3. **Revert semantics.** SQLite doesn't natively support "undo the last transaction's WAL frames."
   We need to figure out the right mechanism—possibly manipulating the WAL index's `mxFrame` and
   relying on the fact that unreferenced frames are invisible to readers, or using savepoints, or
   direct WAL file manipulation.

4. **Checkpoint control.** SQLite auto-checkpoints by default (after 1000 WAL frames). We need fine-
   grained control over when checkpointing happens so we don't lose the ability to revert optimistic
   writes.

5. **Rebase correctness.** When rebasing a local optimistic write on top of newly-arrived server
   state, re-executing the SQL command may produce different results (different rows affected,
   constraint violations that didn't exist before). The client needs to handle these cases
   gracefully.

6. **Memory management.** With the database, WAL, and WAL index all in WASM linear memory, we need
   to be mindful of memory usage for large databases. Checkpointing strategy directly impacts this.

7. **Initial sync.** Clients need to receive the full database state on connection. For large
   databases this could be a significant transfer. We may need to support incremental sync or
   compression.

## Open questions

- What is the right granularity for server-to-client sync: raw WAL frames, or a higher-level
  representation?
- Should the server run SQLite too, or could it use a different storage engine that produces
  WAL-compatible frames?
- How do we handle schema migrations in a world where clients may be mid-transaction when a schema
  change arrives?
- What is our story for conflict resolution beyond "last writer wins at the SQL level"?
- How large can databases get before the in-memory WASM approach becomes impractical?

## Non-goals (for now)

- Offline support / local persistence (databases live on the server, clients are online).
- Multi-tab coordination (one tab, one connection, one thread).
- UI design (TBD, the current focus is the synchronization engine).
