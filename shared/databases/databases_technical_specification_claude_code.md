# Alpine Databases: Realtime Sync Specification

This document specifies the realtime synchronization operations for Alpine Databases. It is intended
to be read by an implementing engineer (human or AI) who will write the TypeScript and C code. Read
`meta/databases_technical_vision.md` for architectural context and `meta/sqlite_wal_format.md` for
the underlying WAL binary format before reading this document.

## Terminology

- **Version**: A monotonically increasing integer (uint64) assigned by the server to each committed
  transaction. Unique per database. Starts at 1. Every committed transaction gets exactly one
  version. Versions are never reused or skipped.
- **Page record**: The unit of data exchanged over the wire: a page number (uint32) paired with the
  full page data (page size bytes). Page records do NOT include WAL checksums or salt values. Those
  are local to each participant's WAL file and are computed on injection.
- **Confirmed state**: The portion of a client's local database that reflects only
  server-committed data. Identified by `confirmedVersion` (what server version the client has
  applied up to) and `confirmedFrameCount` (how many WAL frames in the local WAL file belong to
  confirmed state).
- **Optimistic state**: WAL frames produced by local SQL execution that have not yet been confirmed
  by the server. These frames sit on top of the confirmed state in the WAL and may need to be
  reverted.
- **Frame log**: An append-only archive of committed page records stored in R2/S3. This is separate
  from the server's live WAL file. The frame log is used exclusively for client delta sync
  (backfill) on reconnection.

## State Models

### Client State

```
DatabaseClientState {
  confirmedVersion: uint64
  confirmedFrameCount: uint32
  pendingCommits: DatabasePendingCommit[]
}
```

- `confirmedVersion`: The server version of the last confirmed commit applied to this client. When
  the client receives a `Commit` message from the server, this advances to the commit's version.
- `confirmedFrameCount`: The WAL frame visibility boundary (`mxFrame` in SQLite terminology) for
  the confirmed state. WAL frames 1 through `confirmedFrameCount` are confirmed server data.
  Frames after `confirmedFrameCount` (up to the current `mxFrame`) are optimistic.
- `pendingCommits`: An ordered queue of optimistic commits. The first entry was sent to the server
  first. Each entry tracks enough information to re-execute the SQL on rebase and to know how many
  WAL frames it produced.

```
DatabasePendingCommit {
  clientCommitId: string (UUID)
  sqlStatements: DatabaseSqlStatement[]
  frameCount: uint32
}

DatabaseSqlStatement {
  sql: string
  parameters: DatabaseSqlValue[]
}

DatabaseSqlValue =
  | { type: "null" }
  | { type: "integer"; value: bigint }
  | { type: "real"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; value: Uint8Array }
```

The `confirmedVersion` is persisted in OPFS alongside the database file so the client can resume
from its last confirmed state after a browser restart or tab close:

```
OPFS layout:
  /alpine-databases/{databaseId}/database.sqlite
  /alpine-databases/{databaseId}/database.sqlite-wal
  /alpine-databases/{databaseId}/metadata.json
```

`metadata.json` contains:

```json
{
  "confirmedVersion": 42,
  "pageSize": 4096
}
```

### Server State (Per Database)

```
DatabaseServerState {
  database: SQLiteConnection
  currentVersion: uint64
  pageSize: uint32
  connectedClients: WebSocketConnection[]
}
```

The server holds the canonical SQLite database. It processes writes serially (one at a time). The
`currentVersion` is the version of the most recently committed transaction. This is stored durably
(either in a metadata table inside the SQLite database itself, or in durable object storage).

## Custom SQLite C API Extensions

The sync operations below depend on four custom C API extensions that we must add to our SQLite WASM
build. These operate on the WAL internals and are the low-level building blocks for all sync
operations.

```c
// Returns the current mxFrame value (the WAL frame visibility
// boundary). Frames 1..mxFrame are visible to reads.
unsigned int alpine_wal_get_maximum_frame(sqlite3 *database);

// Inject externally-sourced page records into the local WAL.
//
// Writes WAL frames at positions after the current mxFrame. For each
// page record, computes the local checksum (continuing the chain) and
// uses the local WAL header's salt values. The last injected frame
// gets db_size_after_commit set to databaseSizeInPages (marking it as
// a commit frame). All other injected frames get db_size_after_commit
// set to 0.
//
// After injection, advances mxFrame by the number of injected frames
// and invalidates the page cache for all affected page numbers so
// subsequent reads see the new data.
int alpine_wal_inject_frames(
  sqlite3 *database,
  int frameCount,
  const AlpinePageRecord *frames,
  unsigned int databaseSizeInPages
);

// Revert WAL visibility to targetMaximumFrame.
//
// Sets mxFrame to targetMaximumFrame. Frames after this boundary
// become invisible to reads and will be overwritten by future writes
// or injections. The WAL file is NOT truncated (the invisible frames
// are simply ignored).
//
// Conservatively invalidates the entire page cache to ensure reads
// reflect the reverted state.
int alpine_wal_revert_to_frame(
  sqlite3 *database,
  unsigned int targetMaximumFrame
);

// Capture the page records produced by the most recent committed write
// transaction. Called on the server after sqlite3_exec() + COMMIT to
// extract frames for the frame log and client broadcast.
//
// Returns an array of (pageNumber, pageData) pairs and the count.
int alpine_wal_capture_last_transaction(
  sqlite3 *database,
  AlpinePageRecord **frames,
  int *frameCount
);
```

`AlpinePageRecord` is:

```c
typedef struct {
  unsigned int pageNumber;  // SQLite page number (1-based)
  const void *pageData;     // Full page image (pageSize bytes)
} AlpinePageRecord;
```

## WebSocket Message Types

The databases sync protocol uses **binary WebSocket frames** (not JSON) because the primary payload
is raw SQLite page data. This is different from the rest of Alpine's WebSocket infrastructure which
uses JSON-based protocols via `defineWebSocketProtocol()`. The binary protocol avoids the overhead of
base64-encoding potentially large page data.

All multi-byte integers are big-endian. Each message begins with a 1-byte type tag.

### Client-to-Server Messages

**SyncRequest** (type `0x01`): Sent immediately after WebSocket connection. Reports the client's
last confirmed version so the server can determine the sync strategy.

```
Fields:
  type: uint8 = 0x01
  confirmedVersion: uint64
```

A `confirmedVersion` of 0 means the client has no local state and needs a full snapshot.

**CommitRequest** (type `0x02`): Client sends SQL statements for the server to execute as a single
transaction.

```
Fields:
  type: uint8 = 0x02
  clientCommitId: 16 bytes (UUID)
  baseVersion: uint64 (client's confirmedVersion when the commit was initiated)
  statementCount: uint16
  statements: [repeated statementCount times]
    sqlLength: uint32
    sqlText: UTF-8 bytes (sqlLength bytes)
    parameterCount: uint16
    parameters: [repeated parameterCount times]
      parameterType: uint8 (0x00=null, 0x01=integer, 0x02=real, 0x03=text, 0x04=blob)
      parameterValue: type-dependent encoding
```

All statements in a single `CommitRequest` execute within one SQL transaction on the server. The
`baseVersion` field communicates what confirmed state the client was working from (useful for
diagnostics and future conflict detection strategies).

### Server-to-Client Messages

**SyncSnapshot** (type `0x10`): A full database file. Sent when the client's `confirmedVersion` is
too old for delta sync (or zero).

```
Fields:
  type: uint8 = 0x10
  snapshotVersion: uint64 (the server version at the time of the snapshot)
  pageSize: uint32
  databaseFileData: remaining bytes (raw SQLite database file, fully checkpointed)
```

**Commit** (type `0x11`): A committed transaction's page records. This is the realtime update
format. The exact same message structure is used for live realtime updates pushed to connected
clients and for delta sync replay from the frame log during backfill. There is no separate realtime
update format.

```
Fields:
  type: uint8 = 0x11
  version: uint64
  clientCommitId: 16 bytes (UUID; the originator's UUID for that client, all zeros for others)
  databaseSizeInPages: uint32
  pageRecordCount: uint16
  pageRecords: [repeated pageRecordCount times]
    pageNumber: uint32
    pageData: pageSize bytes
```

The `clientCommitId` field lets the originating client identify which of its pending commits was
confirmed. The server sets this to the submitted UUID only for the originating client's WebSocket
connection. All other clients receive all zeros.

Ordering invariant: `Commit` messages are delivered in strictly increasing `version` order on each
WebSocket connection.

**CommitReject** (type `0x12`): Sent only to the originating client when the server cannot execute
the SQL (constraint violation, syntax error, permission error, etc.).

```
Fields:
  type: uint8 = 0x12
  clientCommitId: 16 bytes (UUID)
  errorMessageLength: uint16
  errorMessage: UTF-8 bytes (errorMessageLength bytes)
```

**SyncComplete** (type `0x13`): Signals the end of the sync phase. The connection transitions to
live mode and the client may begin sending `CommitRequest` messages.

```
Fields:
  type: uint8 = 0x13
  currentVersion: uint64 (the server's latest committed version)
  pageSize: uint32
```

## 1. Client Commit

A client commit is the full lifecycle of a local write: optimistic execution, sending SQL to the
server, rebasing when other clients' commits arrive, and finally receiving the server's canonical
result.

### Step 1: Optimistic local execution

The client executes SQL against its local SQLite instance. This immediately produces WAL frames that
are visible to local reads, giving the user instant feedback.

```
previousMaximumFrame = alpine_wal_get_maximum_frame(database)

sqlite3_exec(database, sqlStatements, parameters)

newMaximumFrame = alpine_wal_get_maximum_frame(database)
optimisticFrameCount = newMaximumFrame - previousMaximumFrame

pendingCommit = {
  clientCommitId: generateUuid(),
  sqlStatements: [{ sql, parameters }],
  frameCount: optimisticFrameCount,
}

pendingCommits.push(pendingCommit)
```

After this step, local reads reflect the optimistic write. The UI can render the result immediately.

### Step 2: Send SQL to server

The client sends the logical SQL statements (not the WAL frames) to the server. The server will
re-execute the SQL against its canonical database.

```
send CommitRequest {
  clientCommitId: pendingCommit.clientCommitId,
  baseVersion: confirmedVersion,
  statements: pendingCommit.sqlStatements,
}
```

Why send SQL instead of WAL frames? Because SQL can be non-deterministic (`random()`,
`datetime('now')`, trigger side effects). The server must execute the SQL itself to produce the
canonical result. The client's optimistic WAL frames are a local preview only.

### Step 3: Handle incoming server commits (rebase)

While the client's commit is in flight, other clients may commit. The server broadcasts those
commits to all connected clients, including this one. When the client receives a `Commit` message
where `clientCommitId` is all zeros (meaning it came from another client), the client must rebase:

```
function handleServerCommit(commit):
  // 1. Revert ALL optimistic frames (roll back to confirmed state)
  alpine_wal_revert_to_frame(database, confirmedFrameCount)

  // 2. Inject the server's canonical page records into the local WAL
  alpine_wal_inject_frames(database, commit.pageRecords, commit.databaseSizeInPages)

  // 3. Advance confirmed state
  confirmedVersion = commit.version
  confirmedFrameCount += commit.pageRecordCount

  // 4. If this commit matches one of our pending commits, remove it
  if commit.clientCommitId matches pendingCommits[0].clientCommitId:
    pendingCommits.shift()

  // 5. Re-execute all remaining pending commits to rebuild optimistic state
  for each pending in pendingCommits:
    previousMaximumFrame = alpine_wal_get_maximum_frame(database)
    try:
      sqlite3_exec(database, pending.sqlStatements)
      pending.frameCount = alpine_wal_get_maximum_frame(database) - previousMaximumFrame
    catch error:
      // Rebase failed for this commit. Remove it from the queue.
      // The server may still process our CommitRequest and either
      // send a Commit (which won't match any pending) or a
      // CommitReject (which we'll handle normally).
      remove pending from pendingCommits
      notify UI of optimistic write failure

  // 6. Checkpoint if safe
  if pendingCommits is empty:
    checkpointIfEligible()
```

This is a **unified algorithm**. The same `handleServerCommit()` function handles both:

- **Commits from other clients** (rebase): `clientCommitId` is all zeros, no pending commit is
  removed, all pending SQL is re-executed on the new base state.
- **Confirmation of our own commit**: `clientCommitId` matches the first pending commit, that
  commit is removed from the queue, remaining pending SQL is re-executed.

The key insight is that even when the server confirms our own commit with no intervening commits,
we still replace our optimistic WAL frames with the server's canonical frames. The server's result
is authoritative because SQL can be non-deterministic.

### Step 4: Handle server rejection

When the server rejects a commit, the client receives a `CommitReject` message:

```
function handleCommitReject(rejection):
  // 1. Revert all optimistic frames
  alpine_wal_revert_to_frame(database, confirmedFrameCount)

  // 2. Remove the rejected commit from the queue
  remove pending where clientCommitId == rejection.clientCommitId

  // 3. Re-execute remaining pending commits
  for each remaining pending in pendingCommits:
    sqlite3_exec(database, pending.sqlStatements)
    pending.frameCount = ...

  // 4. Notify UI of failure
```

### Multiple pending commits

The client may queue multiple pending commits without waiting for confirmation. If the client sends
`CommitRequest` A then `CommitRequest` B before A is confirmed:

- The server processes them in WebSocket arrival order (A then B).
- Each gets its own version.
- The pending queue is `[A, B]`.
- On rebase, both A's and B's SQL are re-executed in order on the new base state.
- When A is confirmed, A is removed, B's SQL is re-executed.
- When B is confirmed, B is removed.

If A is rejected by the server, B may also fail on the server side (for example, B depends on rows
created by A). The server will send a `CommitReject` for B as well.

## 2. Server Commit

The server processes one `CommitRequest` at a time per database. This serialization is inherent to
the execution model (a Cloudflare Durable Object runs single-threaded JavaScript). There are no
concurrent write conflicts on the server.

### Step 1: Execute SQL

```
BEGIN TRANSACTION
for each statement in request.sqlStatements:
  sqlite3_exec(database, statement.sql, statement.parameters)
COMMIT
```

If execution fails at any point (constraint violation, syntax error, permission error), send a
`CommitReject` to the originating client and stop. The transaction is rolled back.

### Step 2: Capture page records

After a successful SQL `COMMIT`, extract the page records produced by the transaction:

```
capturedFrames = alpine_wal_capture_last_transaction(database)
databaseSizeInPages = sqlite3_database_page_count(database)
```

These page records contain just `(pageNumber, pageData)` pairs. They capture all side effects of the
transaction: table data changes, index updates, internal SQLite structures, everything. This is the
beauty of operating at the page level: the sync layer is schema-agnostic.

### Step 3: Assign version

```
currentVersion += 1
version = currentVersion
```

The version counter is stored durably. If the server is a Cloudflare Durable Object, this can be
stored in durable object storage or in a metadata table inside the SQLite database itself.

### Step 4: Write to frame log (durable storage)

Before broadcasting to clients, the server appends the committed page records to the frame log in
R2. This is the durable archive that enables client delta sync on reconnection.

```
frameLogBuffer.append({
  version,
  timestamp: Date.now(),
  databaseSizeInPages,
  pageRecords: capturedFrames,
})

if frameLogBuffer.shouldFlush():
  segment = frameLogBuffer.serialize()
  await r2.put(
    `databases/${databaseId}/frame-log/${padVersion(firstVersionInBuffer)}`,
    segment,
  )
  frameLogBuffer.clear()
```

**The frame log write MUST complete before broadcasting to clients.** This ensures that any commit
a client receives can always be retrieved during future backfill. If the server crashes after writing
the frame log but before broadcasting, clients will pick up the commit on their next reconnection
via delta sync.

The frame log flush policy (when `shouldFlush()` returns true):

- Buffer size >= 1 MB, OR
- >= 10 seconds since the first buffered entry, OR
- Server is shutting down

The R2 key uses the first version in the segment, zero-padded to 20 digits (for example
`00000000000000000042`). This enables lexicographic ordering and efficient range queries with R2's
LIST operation.

### Step 5: Broadcast to connected clients

Send a `Commit` message to every connected WebSocket client for this database:

```
for each client in connectedClients:
  send Commit {
    version,
    clientCommitId:
      client == originatingClient
        ? request.clientCommitId
        : ALL_ZEROS,
    databaseSizeInPages,
    pageRecordCount: capturedFrames.length,
    pageRecords: capturedFrames,
  }
```

The originating client receives its own `clientCommitId` back so it can match the confirmation to
its pending commit. All other clients receive all zeros.

### Step 6: Checkpoint (optional)

The server may checkpoint after this commit. See section 6 (Server Checkpointing) for details.

### What is the realtime update format?

The realtime update IS the `Commit` message (type `0x11`). There is no separate format. The same
binary message is used for:

1. Live realtime updates pushed to connected clients as commits happen.
2. Delta sync replay from the frame log when a client reconnects.

This unification simplifies the client: the same `handleServerCommit()` function processes both live
updates and backfill.

## 3. Client Initialization

Client initialization is the process of loading a database for the first time or resuming from a
locally persisted copy.

### Case A: Fresh client (no local database)

The client has never opened this database before. There is nothing in OPFS.

```
Connection flow:

Client                                    Server
  |                                         |
  |--- WebSocket connect ----------------->  |
  |--- SyncRequest(confirmedVersion=0) --->  |
  |                                         |
  |<-- SyncSnapshot(version, pageSize, db) -|
  |<-- SyncComplete(currentVersion) --------|
  |                                         |
  |         === LIVE MODE ===               |
```

Client processing after receiving `SyncSnapshot`:

```
// 1. Write the database file to OPFS
opfs.writeFile(
  `/alpine-databases/${databaseId}/database.sqlite`,
  snapshot.databaseFileData,
)

// 2. Write metadata for future resumption
opfs.writeFile(
  `/alpine-databases/${databaseId}/metadata.json`,
  JSON.stringify({
    confirmedVersion: snapshot.snapshotVersion,
    pageSize: snapshot.pageSize,
  }),
)

// 3. Open a SQLite connection in exclusive WAL mode
database = sqlite3_open(`/alpine-databases/${databaseId}/database.sqlite`)
sqlite3_exec(database, "PRAGMA locking_mode=EXCLUSIVE")
sqlite3_exec(database, "PRAGMA journal_mode=WAL")
sqlite3_exec(database, "PRAGMA wal_autocheckpoint=0")

// 4. Initialize client state
confirmedVersion = snapshot.snapshotVersion
confirmedFrameCount = 0  // The snapshot is a fully checkpointed database; WAL is empty
pendingCommits = []
```

The `PRAGMA wal_autocheckpoint=0` is critical: it disables SQLite's default auto-checkpoint (which
triggers at 1000 WAL frames). We must control checkpointing ourselves to avoid checkpointing
optimistic frames.

After `SyncComplete`, the client is in live mode. It can read locally and send writes.

### Case B: Returning client (has local database in OPFS)

The client has previously opened this database and has a copy in OPFS.

```
// 1. Load persisted metadata
metadata = JSON.parse(
  opfs.readFile(`/alpine-databases/${databaseId}/metadata.json`)
)

// 2. Open the existing SQLite database from OPFS
database = sqlite3_open(`/alpine-databases/${databaseId}/database.sqlite`)
sqlite3_exec(database, "PRAGMA locking_mode=EXCLUSIVE")
sqlite3_exec(database, "PRAGMA journal_mode=WAL")
sqlite3_exec(database, "PRAGMA wal_autocheckpoint=0")

// 3. Initialize client state from persisted metadata
confirmedVersion = metadata.confirmedVersion
confirmedFrameCount = alpine_wal_get_maximum_frame(database)
pendingCommits = []  // No optimistic state survives browser restart

// 4. Connect and sync (see section 4: Client Backfill)
send SyncRequest { confirmedVersion }
```

No optimistic state survives across browser restarts or reconnections. On startup the client is
always in a clean confirmed state. The local database in OPFS contains only confirmed data (because
we only persist `confirmedVersion` after applying confirmed frames, and any optimistic WAL frames
from a previous session are effectively invisible after the connection state is cleared).

Note: if a previous session crashed with optimistic WAL frames still in the file, those frames are
harmless. The WAL recovery procedure in SQLite will see frames up to the last valid commit boundary.
Since our confirmed frames always end at a valid commit boundary, SQLite will recover to the correct
confirmed state.

## 4. Client Backfill (Reconnection)

When a client reconnects after a WebSocket disconnect (whether after seconds, hours, or days), it
may have missed committed updates. The sync protocol handles this transparently using the same
mechanisms as initialization.

### Server-side decision

When the server receives a `SyncRequest`, it decides the sync strategy:

```
if request.confirmedVersion == 0:
  // Client has no local state at all
  send SyncSnapshot (full database)

else if frameLog.hasVersionsSince(request.confirmedVersion):
  // Client's version is within the frame log retention window.
  // Send only the commits the client missed.
  send delta (series of Commit messages)

else:
  // Client's version is older than the frame log retention window.
  // The frame log no longer has the frames needed for delta sync.
  send SyncSnapshot (full database)
```

### Delta sync (the common case)

When the client's `confirmedVersion` falls within the frame log retention window, the server reads
the relevant frame log segments from R2 and replays them as `Commit` messages:

```
Connection flow:

Client                                     Server
  |                                          |
  |--- SyncRequest(confirmedVersion=42) --->  |
  |                                          | (frame log has versions 1 through 100)
  |<-- Commit(version=43, pageRecords...) ---|
  |<-- Commit(version=44, pageRecords...) ---|
  |<-- ...                                   |
  |<-- Commit(version=100, pageRecords...) --|
  |<-- SyncComplete(currentVersion=100) -----|
  |                                          |
  |        === LIVE MODE ===                 |
```

Server-side pseudocode:

```
for each commit in frameLog.range(
  request.confirmedVersion + 1,
  currentVersion,
):
  send Commit {
    version: commit.version,
    clientCommitId: ALL_ZEROS,  // Historical commits are never from this client
    databaseSizeInPages: commit.databaseSizeInPages,
    pageRecords: commit.pageRecords,
  }

send SyncComplete { currentVersion, pageSize }
```

Client-side processing: the client applies each `Commit` exactly as in live mode using the same
`handleServerCommit()` function. Since `pendingCommits` is empty at reconnection time, no rebase
occurs. Frames are simply injected into the local WAL:

```
for each Commit received during delta sync:
  alpine_wal_inject_frames(database, commit.pageRecords, commit.databaseSizeInPages)
  confirmedVersion = commit.version
  confirmedFrameCount += commit.pageRecordCount

// After all delta commits, checkpoint immediately (safe because
// pendingCommits is empty).
checkpoint()

// Persist updated confirmedVersion
persistMetadata()
```

Checkpointing after delta sync is important to prevent unbounded WAL growth. A client that was
disconnected for a day might receive tens of megabytes of page records.

### Full snapshot (stale client)

When the client's `confirmedVersion` is older than the frame log retention window, the server sends
a full database snapshot. The client replaces its local database entirely:

```
// 1. Close existing SQLite connection
sqlite3_close(database)

// 2. Replace local files with the snapshot
opfs.writeFile(
  `/alpine-databases/${databaseId}/database.sqlite`,
  snapshot.databaseFileData,
)
opfs.deleteFile(
  `/alpine-databases/${databaseId}/database.sqlite-wal`,
)

// 3. Reopen
database = sqlite3_open(`/alpine-databases/${databaseId}/database.sqlite`)
sqlite3_exec(database, "PRAGMA locking_mode=EXCLUSIVE")
sqlite3_exec(database, "PRAGMA journal_mode=WAL")
sqlite3_exec(database, "PRAGMA wal_autocheckpoint=0")

// 4. Reset client state
confirmedVersion = snapshot.snapshotVersion
confirmedFrameCount = 0
pendingCommits = []

// 5. Persist
persistMetadata()
```

### Practical sizing for delta sync

For a productivity database driven by human-speed writes:

| Disconnect duration | Typical delta size | Strategy     |
| ------------------- | ------------------ | ------------ |
| Seconds to minutes  | < 100 KB           | Delta sync   |
| Hours               | 100 KB - 10 MB     | Delta sync   |
| 1 day               | 1 - 50 MB          | Delta sync   |
| 1 week              | 10 - 200 MB        | Delta sync   |
| > retention window  | N/A                | Full snapshot |

The frame log retention window is configurable (recommended: 7-30 days).

## 5. Client Checkpointing

Checkpointing moves committed WAL frames into the main database file, reducing WAL size and OPFS
storage usage.

### Safety rule

**Checkpointing is safe if and only if `pendingCommits` is empty.**

Optimistic WAL frames must never be checkpointed because:

1. Checkpointing is irreversible. It merges WAL pages into the main database file.
2. Optimistic frames may need to be reverted when the server sends a different result or rejects the
   commit.

If we checkpointed optimistic frames, we could never revert them. This would violate server
authority.

### When it happens

Checkpoint when ALL of these are true:

1. `pendingCommits` is empty (no optimistic frames exist).
2. `confirmedFrameCount > 0` (there are WAL frames worth checkpointing).
3. No checkpoint is already in progress.

Practical trigger points:

- **After a `Commit` confirmation empties the pending queue.** When the server confirms the last
  pending commit and no more remain, checkpoint immediately.
- **After a `CommitReject` empties the pending queue.** Same as above.
- **After completing delta sync.** The pending queue is always empty during sync, so checkpoint
  after applying all delta commits.
- **Periodically when idle.** If the client has confirmed frames and no pending commits, checkpoint
  on a timer (for example every 30 seconds of idle time).

### Checkpoint procedure

```
function checkpointIfEligible():
  if pendingCommits.length > 0:
    return  // Not safe to checkpoint
  if confirmedFrameCount == 0:
    return  // Nothing to checkpoint

  // Use TRUNCATE mode to reclaim WAL file disk space
  sqlite3_wal_checkpoint_v2(database, null, SQLITE_CHECKPOINT_TRUNCATE)

  // After TRUNCATE checkpoint:
  //   - All confirmed pages are now in the main database file.
  //   - The WAL file is truncated to zero bytes.
  //   - mxFrame resets to 0.
  //   - A new WAL header with fresh salt values will be written on
  //     the next write.
  confirmedFrameCount = 0

  // Persist confirmedVersion so it survives browser restart.
  // The confirmedVersion does NOT reset. It always tracks the
  // server version.
  persistMetadata()
```

### Auto-checkpoint is disabled

We set `PRAGMA wal_autocheckpoint=0` on every connection open. SQLite's default auto-checkpoint
triggers at 1000 WAL frames. If left enabled, it could checkpoint optimistic frames, making them
irreversible and breaking the rebase/revert mechanism.

## 6. Server Checkpointing

### When it happens

The server can checkpoint freely at any time. It has no optimistic frames. Every write on the
server is immediately canonical. Checkpointing is always safe.

Recommended strategies (pick one):

- **After every commit** (simplest, keeps WAL small)
- **After every N commits** (for example N=10, amortizes checkpoint I/O cost)
- **When WAL frame count exceeds a threshold** (for example 1000 frames)

```
function serverCheckpointIfNeeded():
  if shouldCheckpoint():
    sqlite3_wal_checkpoint_v2(database, null, SQLITE_CHECKPOINT_TRUNCATE)
```

### Relationship with the frame log

**Server checkpointing and the frame log are completely independent.** This is a critical design
point that answers the question of how checkpointing interferes with the frame log (it doesn't).

- The **server's live WAL** (`database.sqlite-wal`) is an ephemeral working file for SQLite's write
  machinery. It is truncated on checkpoint. This is normal SQLite behavior.
- The **frame log** (in R2/S3) is a separate, append-only archive of committed page records. It is
  NOT the server's live WAL. It is NOT affected by server checkpointing in any way.

The flow for each server commit makes this clear:

```
SQL COMMIT
  -> WAL frames appear in the server's live WAL (ephemeral)
  -> Page records are CAPTURED from those frames (alpine_wal_capture_last_transaction)
  -> Page records are WRITTEN to the frame log in R2 (durable, independent copy)
  -> Page records are BROADCAST to connected clients
  -> Server MAY checkpoint its live WAL (does not touch the frame log)
```

The page records are captured from the WAL frames before any checkpoint happens. Even if the server
checkpoints immediately after every commit (truncating its live WAL), the frame log retains the
page records independently.

### Frame log retention and cleanup

The frame log accumulates page records over time. A retention policy controls how long old segments
are kept. Segments older than the retention window are deleted periodically.

```
Cleanup (runs periodically, for example daily):

cutoffTimestamp = now - retentionWindow
cutoffVersion = frameLog.findVersionAtTimestamp(cutoffTimestamp)
frameLog.deleteSegmentsBefore(cutoffVersion)
```

After cleanup, any client with `confirmedVersion < cutoffVersion` will receive a full snapshot
instead of a delta on their next sync.

### Snapshot creation for fast full sync

The server periodically creates full database snapshots in R2 so that full-sync responses can be
served quickly (without reading the live database):

```
sqlite3_wal_checkpoint_v2(database, null, SQLITE_CHECKPOINT_TRUNCATE)
databaseBytes = readFile("database.sqlite")
await r2.put(
  `databases/${databaseId}/snapshots/${currentVersion}`,
  databaseBytes,
)
```

Recommended frequency: after every ~100 commits or when the latest snapshot is older than 1 hour.
Keep the 2-3 most recent snapshots and delete older ones.

## Frame Log Storage Format

The frame log is stored in R2/S3 as **segments**. Each segment is a binary blob containing one or
more consecutive commits. Segments are the unit of R2 I/O.

### R2 key pattern

```
databases/{databaseId}/frame-log/{firstVersion:020d}
```

The version is zero-padded to 20 digits for lexicographic ordering. This enables efficient range
queries with R2's LIST operation to find segments relevant to a client's `confirmedVersion`.

### Segment binary format

```
Segment header (16 bytes):
  magic: uint32 = 0x414C4653 ("ALFS" - Alpine Frame Segment)
  formatVersion: uint16 = 1
  pageSize: uint32
  commitCount: uint32
  reserved: uint16 = 0

Commit entries (repeated commitCount times):
  version: uint64
  timestampMilliseconds: uint64 (Unix epoch)
  databaseSizeInPages: uint32
  pageRecordCount: uint16
  pageRecords: [repeated pageRecordCount times]
    pageNumber: uint32
    pageData: pageSize bytes
```

### Segment flush policy

The server buffers commits in memory and flushes to R2 when:

- Buffer size >= 1 MB, OR
- >= 10 seconds since the first buffered entry, OR
- Server is shutting down

### Reading segments for delta sync

```
1. LIST databases/{databaseId}/frame-log/ with start-after based on
   the client's confirmedVersion (find the segment that contains
   confirmedVersion + 1).
2. For each relevant segment:
   a. GET the segment from R2.
   b. Parse the binary format.
   c. Skip commits with version <= client's confirmedVersion.
   d. Stream remaining commits to the client as Commit messages.
```

## Invariants and Safety Properties

These invariants must be maintained by the implementation. They are useful both for understanding
the system and for writing assertions in the code.

1. **Version monotonicity.** The server assigns versions in strictly increasing order starting from
   1. `Commit` messages arrive in version order on each WebSocket connection.

2. **Server authority.** The server's page records are always canonical. Client optimistic frames
   are always replaced by server frames, even when no intervening commits occurred, because SQL can
   be non-deterministic (`random()`, `datetime('now')`, trigger side effects).

3. **Checkpoint safety.** The client NEVER checkpoints while `pendingCommits` is non-empty.
   Optimistic frames must remain revertible.

4. **Page size immutability.** All clients and the server use the same page size for a given
   database. The page size is fixed at database creation time and never changed.

5. **Checksum and salt locality.** WAL checksums and salt values are never transmitted over the
   wire. Each client computes its own checksum chain locally during frame injection using
   `alpine_wal_inject_frames`. This is possible because checksums and salts are a property of the
   local WAL file, not of the logical data.

6. **Frame log durability before broadcast.** The server writes to the frame log in R2 before
   broadcasting `Commit` messages to clients. Any commit a client receives can be retrieved during
   future backfill.

7. **Idempotent delta sync.** If a client receives a `Commit` with `version <= confirmedVersion`
   (possible edge case during reconnection race conditions), it skips the message.

8. **No optimistic state survives reconnection.** On disconnect, the client reverts to confirmed
   state and clears `pendingCommits`. No pending commit tracking persists across connections.

9. **Rebase correctness.** Re-executing pending SQL during rebase may produce different results
   (different pages affected, different frame count, constraint failure). All outcomes are valid
   because the re-execution reflects the true database state after the intervening server commit.

10. **Single-writer server.** The server processes one `CommitRequest` at a time per database.
    Version assignment, frame log write, and broadcast are all serialized.
