# Databases: Vision

Alpine Databases is a realtime collaborative database product (similar to Airtable, Smartsheet, or
Notion databases) powered by SQLite running in the browser via WASM.

The core technical insight is using **SQLite WAL (Write-Ahead Logging)** as the synchronization
primitive between a canonical server and connected clients. WAL gives us a structured, ordered log
of page-level mutations that we can stream, apply, and revert—making it the backbone of our
optimistic concurrency model.

## Architecture

### Server

A centralized server holds the canonical SQLite database for each user database. The server runs the
**same custom SQLite WASM build and TypeScript code** as the client—one shared implementation across
Cloudflare Workers, Node.js, and the browser. All committed writes flow through the server, which:

1. Applies SQL writes to the canonical database.
2. Produces WAL frames as a byproduct of each transaction.
3. Streams those WAL frames to all connected clients in commit order.
4. Archives WAL frames in a **frame log** with a retention window (e.g. 7–30 days) for delta sync on
   client reconnection.

The server is the single source of truth. Its WAL frame sequence defines the authoritative state of
the database. The server checkpoints its own database normally—the frame log is a separate append-
only archive, not the server's live WAL.

### Client

Each client runs a single SQLite instance in WASM inside a **shared web worker**. All browser tabs
for the same database share this one worker. The worker processes one operation at a time—no
concurrent reads or writes within SQLite. Since all interactions are driven by humans through UI,
this serialization is not a bottleneck.

#### Storage and sync

The client persists its database locally via **OPFS** (Origin Private File System). This enables
fast startup: instead of downloading the full database on every connection, the client can resume
from its local copy.

On connection the client reports its last confirmed frame number to the server. The server decides
the sync strategy:

- **Delta sync (common case):** The client's frame number falls within the server's frame log
  retention window. The server streams only the WAL frames the client missed. The client applies
  them and checkpoints locally (safe because these are confirmed server frames with no pending
  optimistic writes at reconnect time). For a productivity database driven by human writes, even a
  week of frames is typically only tens of megabytes—fast to stream.
- **Full snapshot (stale client):** The client's frame number is older than the retention window (or
  the client has no local database at all). The server sends a full database snapshot. The client
  replaces its local copy and starts fresh.

The threshold is simple: if the server still has the frames, send the delta; otherwise send a
snapshot. This avoids ever needing to keep WAL frames indefinitely.

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
    - **Intervening commits:** While the client's write is in flight, other users' commits may
      arrive via the realtime stream. The client must revert its optimistic frames, apply the
      incoming server frames, then re-execute the original SQL command locally to produce fresh
      optimistic frames on top of the new base state. This "rebase" may need to happen multiple
      times before the client's own write is confirmed by the server.
4. **Failure:** The server rejects the write (constraint violation, permission error, etc.). The
   client reverts its local WAL frames, discarding the optimistic update.

The key property that makes this work: **WAL frames are revertible.** We can undo a local optimistic
write by discarding its WAL frames and restoring the prior database state, because the original
pages are still in the database file until a checkpoint moves them.

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

SQLite's official WASM build does not support WAL mode in the general case. This is our primary
technical challenge.

### Why WAL doesn't work in WASM today

WAL mode normally requires the VFS to implement four shared-memory methods (`xShmMap`, `xShmLock`,
`xShmBarrier`, `xShmUnmap`). These manage the **WAL index** (the `-shm` file), a shared-memory
region that:

- Maps page numbers to their locations in the WAL file via a hash table, so readers can quickly find
  the latest version of any page without scanning the entire WAL.
- Coordinates concurrent readers and writers through lock bytes and read-marks.

On native platforms this is implemented via `mmap()` on a shared file. Browsers have no equivalent
primitive, so the official WASM build omits these methods entirely.

### Exclusive locking mode: our path forward

SQLite has an **exclusive locking mode** (`PRAGMA locking_mode=EXCLUSIVE`) where it assumes a single
connection owns the database. In this mode:

- The WAL index is kept in **heap memory** instead of shared memory. The `xShm*` VFS methods are
  never called.
- No lock arbitration or atomic operations are needed.
- The official SQLite WASM build (3.47+) already supports WAL in exclusive locking mode for
  OPFS-hosted databases, proving the basic machinery works.

This is a perfect fit for us. We deliberately run a single SQLite connection in one web worker—we
don't want or need concurrency. Exclusive locking mode is not a limitation, it's our design.

The remaining challenge is that the official WASM build doesn't expose the frame-level control we
need. We can likely use its OPFS VFS (or a derivative) for storage, but we need hooks to intercept,
inject, and revert WAL frames.

### What we need to build

A **custom SQLite WASM build** that supports WAL in exclusive locking mode with frame-level control.
This means:

1. Compiling SQLite to WASM with WAL enabled and exclusive locking mode.
2. Using OPFS for local persistence (the official build already supports this) or writing a custom
   VFS if we need more control over file I/O.
3. Adding hooks (likely thin C API extensions) for injecting server WAL frames, extracting local WAL
   frames, and reverting optimistic writes.
4. Wrapping this in a JavaScript API that the rest of Alpine's client code can use.

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
- **Official SQLite WASM (3.47+)** supports WAL in exclusive locking mode, which uses heap memory
  for the WAL index. Proves the WAL machinery works in WASM but is tied to OPFS and doesn't give us
  frame-level control.
- **cr-sqlite** supports WAL in native Node.js but not in browser WASM.

None of these projects have attempted what we're doing: using WAL frames as a synchronization
protocol. We are likely the first to need this specific capability.

## Expected difficulties

1. **Custom SQLite WASM build.** We need to compile SQLite ourselves with a custom VFS rather than
   using an off-the-shelf WASM distribution. This is a meaningful build infrastructure investment.

2. **WAL frame interception and invariants.** SQLite's WAL is an internal implementation detail, not
   a public API surface. Extracting frames after local writes and injecting server frames will
   require either patching SQLite source or carefully hooking the VFS layer. Beyond the interception
   mechanism, frame replication has hard physical invariants that must be maintained:
    - **Page size pinning.** Server and all clients must use the same page size. This must be set at
      database creation and never changed, since WAL frames are raw pages.
    - **Checksum chain.** Each WAL frame contains a cumulative checksum that chains from the
      previous frame. Injecting server frames means either replaying the server's checksum chain or
      recomputing it locally. A broken chain makes the WAL unreadable.
    - **Salt values.** The WAL header contains two salt values that change on every WAL reset
      (checkpoint that truncates the WAL). Frames are only valid if their salts match the WAL
      header. Server-to-client frame injection must account for this.
    - These invariants need to be fully understood and pinned down during the feasibility spike
      before we commit to a wire format.

3. **Revert semantics.** SQLite doesn't natively support "undo the last transaction's WAL frames."
   We need to figure out the exact mechanism, and it's harder than "just discard the frames" because
   we need to account for:
    - **Connection state:** What happens to open transactions, prepared statements, and cached state
      when we rewind the WAL underneath SQLite? We may need to close and reopen the connection, or
      find a way to invalidate SQLite's internal caches.
    - **WAL index consistency:** If we manipulate `mxFrame` to hide optimistic frames, the WAL index
      hash table still has entries for those frames. We need to understand whether SQLite handles
      this gracefully or whether the index must be rebuilt/corrected.
    - **Frame boundaries:** We must track exactly which WAL frames belong to each optimistic write
      so we know precisely where to rewind to. This means recording the frame boundary (start/end
      frame number and base server commit sequence) for every speculative mutation.
    - Possible approaches: manipulating `mxFrame` and relying on unreferenced frames being invisible
      to readers, savepoints, direct WAL file truncation, or closing and reopening the database. The
      feasibility spike must determine which approach is correct.

4. **Checkpoint control.** SQLite auto-checkpoints by default (after 1000 WAL frames). We need to
   disable auto-checkpoint and only checkpoint at explicit safe boundaries. The rule: checkpointing
   is safe after applying **confirmed server frames** with no pending optimistic writes. It is never
   safe to checkpoint while optimistic frames exist, because checkpointing merges WAL pages into the
   database file, making them irreversible.

5. **Rebase correctness.** When rebasing a local optimistic write on top of newly-arrived server
   state, re-executing the SQL command may produce different results (different rows affected,
   constraint violations that didn't exist before). The client needs to handle these cases
   gracefully.

6. **Memory management.** With OPFS, only SQLite's page cache lives in WASM linear memory—the full
   database stays on disk and pages are loaded on demand. This means large databases don't blow up
   memory, but we still need to be thoughtful about page cache sizing and WAL growth (uncheck-
   pointed WAL frames accumulate in memory via the WAL index).

7. **Frame log retention.** The server needs to archive WAL frames in an append-only log with a
   retention window. Choosing the right retention period is a tradeoff between storage cost and how
   often clients fall back to full snapshots. The frame log storage (likely R2 or similar) needs to
   support efficient range reads by frame number.

`shared/databases/meta/sqlite_wal_format.md` is a useful reference on the SQLite WAL format for our
use case we can refer to while working through these difficulties.

## Open questions

- What is the right granularity for server-to-client sync: raw WAL frames, or a higher-level
  representation?
- How do we handle schema migrations in a world where clients may be mid-transaction when a schema
  change arrives?
- What is our story for conflict resolution beyond "last writer wins at the SQL level"?
- How large can databases get before the WASM/OPFS approach becomes impractical?

## Non-goals (for now)

- Offline support (OPFS persistence is for fast reconnect, not offline editing).
- SQLite concurrency (single connection in exclusive locking mode by design).
- UI design (TBD, the current focus is the synchronization engine).
