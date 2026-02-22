# Alpine Databases: Realtime Sync Protocol Specification

This document specifies the concrete byte-level formats and operational procedures for Alpine's
realtime database synchronization. It covers six core operations: client commit, server commit,
client initialization, client backfill, client checkpointing, and server checkpointing.

**Prerequisites:** Read `databases_technical_vision.md` for architectural context and
`sqlite_wal_format.md` for the underlying WAL binary format.

## Terminology

- **Version**: A monotonically increasing uint64 assigned by the server to each committed
  transaction. Unique per database. Starts at 1.
- **Page record**: The wire format unit: a page number (uint32) + page data (page_size bytes). Does
  not include WAL checksums or salts (those are local to each client's WAL file).
- **Confirmed state**: The client's state reflecting only server-committed data. Identified by the
  client's `confirmedVersion` and `confirmedMxFrame`.
- **Optimistic state**: WAL frames produced by local SQL execution that have not yet been confirmed
  by the server.
- **mxFrame**: The WAL frame visibility boundary. Frames at or before mxFrame are visible to reads;
  frames after are invisible. In exclusive locking mode this is stored in heap memory.
- **Frame log**: An append-only archive of committed page records stored in R2/S3. Separate from
  the server's live WAL file. Used for client delta sync (backfill).

## Client State Model

```
ClientState {
  confirmedVersion: uint64         // Last confirmed server version
  confirmedMxFrame: uint32     // WAL mxFrame boundary for confirmed state
  pendingCommits: PendingCommit[]  // Ordered queue of optimistic commits

  // Derived: currentMxFrame = confirmedMxFrame + sum(pending[*].frameCount)
}

PendingCommit {
  clientCommitId: UUID (16 bytes)  // Correlation ID sent to server
  sql: string                      // SQL statement(s) to re-execute on rebase
  params: Value[]                  // Bound parameters
  frameCount: uint32               // WAL frames this optimistic commit produced
}
```

The `confirmedVersion` is persisted to a metadata file in OPFS alongside the database
(`meta.json`), updated after applying confirmed server frames and after checkpoint. This allows
the client to resume from its last confirmed state after a browser restart.

```
OPFS layout:
  /databases/{db_id}/database.db
  /databases/{db_id}/database.db-wal
  /databases/{db_id}/meta.json   →  { "confirmedVersion": 42, "pageSize": 4096 }
```

## WebSocket Protocol

### Connection Lifecycle

```
Client                                 Server
  |                                      |
  |--- WebSocket connect -------------→ |
  |--- SyncRequest(confirmedVersion) -----→ |
  |                                      |  (server checks version against frame log)
  |                                      |
  |  [if stale or version=0]                 |
  |←---------- SyncSnapshot(db file) ---|
  |                                      |
  |  [if within retention window]        |
  |←---------- Commit(version=N+1) ---------|
  |←---------- Commit(version=N+2) ---------|
  |←---------- ...                       |
  |                                      |
  |←---------- SyncComplete ------------|
  |                                      |
  |          === LIVE MODE ===           |
  |                                      |
  |--- CommitRequest(sql) -----------→  |
  |←---------- Commit(version=...) ---------|
  |←---------- CommitReject ------------|
```

### Binary Message Format

All WebSocket messages use binary frames. Each message begins with a 1-byte type tag. All
multi-byte integers are big-endian.

| Type   | Direction | Name           |
| ------ | --------- | -------------- |
| `0x01` | C → S     | SyncRequest    |
| `0x02` | C → S     | CommitRequest  |
| `0x10` | S → C     | SyncSnapshot   |
| `0x11` | S → C     | Commit         |
| `0x12` | S → C     | CommitReject   |
| `0x13` | S → C     | SyncComplete   |

---

### `SyncRequest` (0x01) — Client → Server

Sent immediately after WebSocket connection. Reports the client's last confirmed version.

```
Offset  Size  Field
0       1     type = 0x01
1       8     confirmedVersion (uint64 BE)
```

Total: 9 bytes. A `confirmedVersion` of 0 means the client has no local state and needs a full
snapshot.

---

### `CommitRequest` (0x02) — Client → Server

Client sends SQL for server execution.

```
Offset  Size  Field
0       1     type = 0x02
1       16    clientCommitId (UUID, 16 bytes)
17      8     baseVersion (uint64 BE, client's confirmedVersion at time of commit)
25      2     statementCount (uint16 BE)

For each statement:
  +0     4     sqlLength (uint32 BE)
  +4     var   sqlText (UTF-8, sqlLength bytes)
  +var   2     paramCount (uint16 BE)
  For each param:
    +0    1     paramType (uint8)
    +1    var   paramValue (type-dependent)
```

All statements in a single `CommitRequest` are executed within one SQL transaction on the server.
The `baseVersion` field communicates what confirmed state the client was working from (useful for
diagnostics and future conflict detection).

**Parameter type encoding:**

| Type byte | SQLite affinity | Value encoding                           |
| --------- | --------------- | ---------------------------------------- |
| `0x00`    | NULL            | No value bytes                           |
| `0x01`    | INTEGER         | 8 bytes (int64 BE)                       |
| `0x02`    | REAL            | 8 bytes (float64 BE, IEEE 754)           |
| `0x03`    | TEXT            | 4 bytes length (uint32 BE) + UTF-8 bytes |
| `0x04`    | BLOB            | 4 bytes length (uint32 BE) + raw bytes   |

---

### `SyncSnapshot` (0x10) — Server → Client

Full database file. Sent when client's `confirmedVersion` is stale or zero.

```
Offset  Size  Field
0       1     type = 0x10
1       8     snapshotVersion (uint64 BE, server version at time of snapshot)
9       4     pageSize (uint32 BE)
13      var   dbFileData (raw SQLite database file, rest of WebSocket message)
```

The database file is fully checkpointed (no WAL component). The client replaces its local database
with this file.

---

### `Commit` (0x11) — Server → Client

A committed transaction's page records. The same message format is used for both live realtime
updates and delta sync replay. This IS the realtime update format—there is no separate format.

```
Offset  Size  Field
0       1     type = 0x11
1       8     version (uint64 BE)
9       16    clientCommitId (UUID; non-zero for originating client, all zeros for others)
25      4     dbSize (uint32 BE, database size in pages after this commit)
29      2     frameCount (uint16 BE)

For each frame (repeated frameCount times):
  +0     4     pgno (uint32 BE)
  +4     var   pageData (pageSize bytes)
```

Total: 31 + frameCount × (4 + pageSize) bytes.

**`clientCommitId` semantics:** When the server broadcasts a commit, it sets `clientCommitId` to
the originator's submitted UUID for that specific client's WebSocket connection, and to all zeros
for every other client. This lets the originating client identify which of its pending commits was
confirmed. Other clients ignore this field.

**Ordering invariant:** `Commit` messages are always delivered in strictly increasing version order on
each WebSocket connection.

---

### `CommitReject` (0x12) — Server → Client

Sent only to the originating client when the server cannot execute the SQL.

```
Offset  Size  Field
0       1     type = 0x12
1       16    clientCommitId (UUID)
17      2     errorLength (uint16 BE)
19      var   errorMessage (UTF-8, errorLength bytes)
```

---

### `SyncComplete` (0x13) — Server → Client

Signals end of sync phase. Connection transitions to live mode.

```
Offset  Size  Field
0       1     type = 0x13
1       8     currentVersion (uint64 BE, server's latest version)
9       4     pageSize (uint32 BE)
```

After receiving `SyncComplete`, the client may begin sending `CommitRequest` messages.

---

## 1. Client Commit

### Step 1: Optimistic local execution

The client executes SQL against its local SQLite, which produces WAL frames immediately visible
to local reads.

```
previousMxFrame = alpine_wal_get_mx_frame(db)
sqlite3_exec(db, sql, params)
newMxFrame = alpine_wal_get_mx_frame(db)
optimisticFrameCount = newMxFrame - previousMxFrame

pendingCommits.push({
  clientCommitId: generateUUID(),
  sql,
  params,
  frameCount: optimisticFrameCount,
})
```

### Step 2: Send to server

```
send(CommitRequest {
  type: 0x02,
  clientCommitId,
  baseVersion: confirmedVersion,
  statements: [{ sql, params }],
})
```

### Step 3: Rebase on intervening server commits

While the client's commit is in flight, other clients' commits may arrive. When the client
receives a `Commit` message where `clientCommitId` is all zeros (someone else's commit):

```
// 1. Revert all optimistic frames
alpine_wal_revert(db, confirmedMxFrame)

// 2. Inject server frames into local WAL
alpine_wal_inject(db, commit.frames, commit.dbSize)
confirmedVersion = commit.version
confirmedMxFrame += commit.frameCount

// 3. Re-execute all pending commits' SQL to produce fresh optimistic frames
for each pending in pendingCommits:
  previousMxFrame = alpine_wal_get_mx_frame(db)
  try:
    sqlite3_exec(db, pending.sql, pending.params)
    pending.frameCount = alpine_wal_get_mx_frame(db) - previousMxFrame
  catch error:
    // Rebase failed for this commit—remove from queue.
    // If the server later commits it, the Commit message will
    // arrive and be applied as a normal server commit (the
    // clientCommitId won't match any pending commit).
    remove pending from pendingCommits
    notify UI of optimistic write failure
```

This rebase may happen multiple times before the client's own commit is confirmed.

### Step 4a: Server confirms (Commit with matching clientCommitId)

```
// 1. Revert all optimistic frames
alpine_wal_revert(db, confirmedMxFrame)

// 2. Inject server's CANONICAL frames (not the client's optimistic ones).
//    Server frames are authoritative even with no intervening commits,
//    because SQL can be non-deterministic (random(), datetime('now'),
//    trigger side effects, etc.).
alpine_wal_inject(db, commit.frames, commit.dbSize)
confirmedVersion = commit.version
confirmedMxFrame += commit.frameCount

// 3. Remove confirmed commit from pending queue
remove matching pending from pendingCommits

// 4. Re-execute remaining pending commits' SQL
for each remaining pending in pendingCommits:
  previousMxFrame = alpine_wal_get_mx_frame(db)
  sqlite3_exec(db, pending.sql, pending.params)
  pending.frameCount = alpine_wal_get_mx_frame(db) - previousMxFrame

// 5. Checkpoint if safe (see §5. Client Checkpointing)
if pendingCommits is empty:
  checkpoint_if_safe()
```

**Unified algorithm:** Steps 3 and 4a are nearly identical. The only difference is whether a
pending commit is removed from the queue. This can be implemented as a single `handleCommit()`
function:

```
handleCommit(commit):
  alpine_wal_revert(db, confirmedMxFrame)
  alpine_wal_inject(db, commit.frames, commit.dbSize)
  confirmedVersion = commit.version
  confirmedMxFrame += commit.frameCount

  if commit.clientCommitId matches a pending commit:
    remove it from pendingCommits

  for each remaining pending in pendingCommits:
    re-execute SQL, update frameCount

  if pendingCommits is empty:
    checkpoint_if_safe()
```

### Step 4b: Server rejects (CommitReject)

```
// 1. Revert all optimistic frames
alpine_wal_revert(db, confirmedMxFrame)

// 2. Remove rejected commit from pending queue
remove matching pending from pendingCommits

// 3. Re-execute remaining pending commits' SQL
for each remaining pending in pendingCommits:
  sqlite3_exec(db, pending.sql, pending.params)
  pending.frameCount = ...

// 4. Notify UI of failure
```

### Multiple pending commits

The client can queue multiple pending commits. If the client sends CommitRequest A then
CommitRequest B before A is confirmed:

- The server processes them in WebSocket arrival order (A then B).
- Each gets its own version.
- The client's pending queue is `[A, B]`.
- On rebase, both A's and B's SQL are re-executed in order.
- When A is confirmed, A is removed and B's SQL is re-executed once more.
- When B is confirmed, B is removed.

If A is rejected by the server, B may also fail (e.g., B depends on rows created by A). The
server executes B against canonical state without A's effects, which may cause a `CommitReject`
for B as well.

---

## 2. Server Commit

The server processes one `CommitRequest` at a time per database. This serialization is inherent
to the execution model (e.g., a Cloudflare Durable Object's single-threaded JavaScript runtime).

### Step 1: Execute SQL

```
BEGIN TRANSACTION
sqlite3_exec(db, sql, params)
COMMIT
```

If execution fails (constraint violation, syntax error, permission error, etc.), send
`CommitReject` to the originating client and stop.

### Step 2: Capture page records

After successful SQL COMMIT, capture the page records produced by the transaction:

```
frames = alpine_wal_capture_last_tx(db)
// Returns: [(pgno, pageData), ...] for each WAL frame in the committed transaction.
dbSize = sqlite3_db_page_count(db)
```

### Step 3: Assign version

```
version = ++versionCounter
// versionCounter is durably stored (e.g., in Durable Object storage or in the
// SQLite database itself in a metadata table).
```

### Step 4: Write to frame log

Append the commit to the frame log buffer. The buffer is flushed to R2/S3 as a segment (see
§ Frame Log Storage for the binary format).

```
frameLogBuffer.append({
  version,
  timestamp: Date.now(),
  dbSize,
  frames,
})

if frameLogBuffer.shouldFlush():  // ≥1 MB or ≥10 seconds since first entry
  segment = frameLogBuffer.serialize()
  await r2.put(`databases/${dbId}/frame-log/${firstVersion.padStart(20, '0')}`, segment)
  frameLogBuffer.clear()
```

**Durability requirement:** The frame log write MUST complete before broadcasting to clients.
This ensures that any commit a client receives can be retrieved during future backfill. If the
server crashes after write but before broadcast, clients will pick up the commit on reconnect
via delta sync.

### Step 5: Broadcast to clients

Send a `Commit` message (0x11) to every connected WebSocket client for this database:

```
for each connectedClient:
  send(Commit {
    version,
    clientCommitId: (connectedClient == originator) ? request.clientCommitId : ALL_ZEROS,
    dbSize,
    frameCount: frames.length,
    frames,
  })
```

### Step 6: Checkpoint server WAL

The server can checkpoint after every commit or periodically. Since the server has no optimistic
frames, checkpointing is always safe. See § Server Checkpointing for details.

### Realtime update format

The realtime update IS the `Commit` message (0x11). There is no separate realtime format. The
same binary message structure is used for:

- Live realtime updates (pushed immediately as commits are processed)
- Delta sync (replayed from the frame log during client backfill)

---

## 3. Client Initialization

### Case A: Fresh client (no local database)

```
Client                                    Server
  |                                         |
  |--- WS connect ----------------------→  |
  |--- SyncRequest(confirmedVersion=0) -----→  |
  |                                         |
  |←--- SyncSnapshot(version, pageSize, db) ---|
  |←--- SyncComplete(currentVersion) ----------|
  |                                         |
  |      === LIVE MODE ===                  |
```

Client processing:

```
// 1. Write database file to OPFS
opfs.writeFile("/databases/{db_id}/database.db", snapshot.dbFileData)

// 2. Write metadata
opfs.writeFile("/databases/{db_id}/meta.json", JSON.stringify({
  confirmedVersion: snapshot.snapshotVersion,
  pageSize: snapshot.pageSize,
}))

// 3. Open SQLite connection in exclusive WAL mode
db = sqlite3_open("/databases/{db_id}/database.db")
sqlite3_exec(db, "PRAGMA locking_mode=EXCLUSIVE")
sqlite3_exec(db, "PRAGMA journal_mode=WAL")
sqlite3_exec(db, "PRAGMA wal_autocheckpoint=0")  // Disable auto-checkpoint

// 4. Initialize client state
confirmedVersion = snapshot.snapshotVersion
confirmedMxFrame = 0   // WAL is empty (snapshot is a checkpointed database)
pendingCommits = []
```

The client can now perform local reads and send writes.

### Case B: Returning client (has local database in OPFS)

```
// 1. Load persisted state
meta = JSON.parse(opfs.readFile("/databases/{db_id}/meta.json"))

// 2. Open SQLite from OPFS
db = sqlite3_open("/databases/{db_id}/database.db")
sqlite3_exec(db, "PRAGMA locking_mode=EXCLUSIVE")
sqlite3_exec(db, "PRAGMA journal_mode=WAL")
sqlite3_exec(db, "PRAGMA wal_autocheckpoint=0")

// 3. Initialize client state
confirmedVersion = meta.confirmedVersion
confirmedMxFrame = alpine_wal_get_mx_frame(db)
pendingCommits = []  // No pending commits survive restart/reconnection

// 4. Connect and sync (see §4. Client Backfill)
```

---

## 4. Client Backfill (Reconnection)

On WebSocket disconnect/reconnect—whether after seconds or days—the client may have missed
committed updates. The sync protocol handles this transparently.

### Server-side decision

```
if client.confirmedVersion == 0:
  → send SyncSnapshot (full database)
elif frameLog.hasFramesSince(client.confirmedVersion):
  → send delta (series of Commit messages)
else:
  // Client's version is older than frame log retention window
  → send SyncSnapshot (full database)
```

### Delta sync (common case)

When the client's `confirmedVersion` falls within the frame log retention window, the server replays
all commits the client missed:

```
Client                                     Server
  |                                          |
  |--- SyncRequest(confirmedVersion=42) ------→  |
  |                                          |  (frame log has versions 1–100)
  |←--- Commit(version=43, frames...) ----------|
  |←--- Commit(version=44, frames...) ----------|
  |←--- ...                                 |
  |←--- Commit(version=100, frames...) ---------|
  |←--- SyncComplete(currentVersion=100) -------|
  |                                          |
  |       === LIVE MODE ===                  |
```

The server reads the relevant frame log segments from R2 and replays them as `Commit` messages:

```
for each commit in frameLog.range(client.confirmedVersion + 1, currentVersion):
  send Commit {
    version: commit.version,
    clientCommitId: ALL_ZEROS,  // Historical commits never match pending
    dbSize: commit.dbSize,
    frames: commit.frames,
  }
send SyncComplete(currentVersion, pageSize)
```

The client processes each `Commit` identically to live mode. Since `pendingCommits` is empty at
reconnection time, no rebase occurs—frames are simply injected:

```
for each Commit during delta sync:
  alpine_wal_inject(db, commit.frames, commit.dbSize)
  confirmedVersion = commit.version
  confirmedMxFrame += commit.frameCount

// After all delta commits are applied, checkpoint immediately.
// This is safe because pendingCommits is empty.
checkpoint()

// Persist updated state
persistMeta({ confirmedVersion, pageSize })
```

Checkpointing after delta sync is important to prevent unbounded WAL growth from a long delta.

### Full snapshot (stale client)

When the client's version is outside the frame log retention window:

```
// 1. Close existing SQLite connection
sqlite3_close(db)

// 2. Replace local database with snapshot
opfs.writeFile("/databases/{db_id}/database.db", snapshot.dbFileData)
opfs.deleteFile("/databases/{db_id}/database.db-wal")  // Remove stale WAL

// 3. Reopen
db = sqlite3_open("/databases/{db_id}/database.db")
sqlite3_exec(db, "PRAGMA locking_mode=EXCLUSIVE")
sqlite3_exec(db, "PRAGMA journal_mode=WAL")
sqlite3_exec(db, "PRAGMA wal_autocheckpoint=0")

// 4. Update state
confirmedVersion = snapshot.snapshotVersion
confirmedMxFrame = 0
pendingCommits = []

// 5. Persist
persistMeta({ confirmedVersion, pageSize })
```

### Practical sizing for long disconnections

For a productivity database driven by human-speed writes:

| Disconnect duration | Typical delta size | Strategy       |
| ------------------- | ------------------ | -------------- |
| Seconds to minutes  | < 100 KB           | Delta sync     |
| Hours               | 100 KB – 10 MB     | Delta sync     |
| 1 day               | 1 – 50 MB          | Delta sync     |
| 1 week              | 10 – 200 MB        | Delta sync     |
| > retention window  | N/A                | Full snapshot   |

The frame log retention window is configurable (recommended: 7–30 days).

---

## 5. Client Checkpointing

Checkpointing moves committed WAL frames into the main database file, reducing WAL size and
OPFS storage usage.

### When it happens

**Safety rule: Checkpointing is safe if and only if `pendingCommits` is empty.**

Optimistic frames must never be checkpointed because:

1. Checkpointing is irreversible—pages are merged into the main database file.
2. Optimistic frames may need to be reverted on rebase or server rejection.

### Trigger conditions

Checkpoint when ALL of these are true:

1. `pendingCommits` is empty (no optimistic frames exist)
2. `confirmedMxFrame > 0` (there are WAL frames to checkpoint)
3. No checkpoint is already in progress

Practical triggers:

- After a `Commit` confirmation clears the last pending commit
- After a `CommitReject` clears the last pending commit
- After applying delta sync frames (always safe—`pendingCommits` is empty during sync)
- Periodically when idle with no pending commits

### Checkpoint procedure

```
// Use TRUNCATE mode to reclaim WAL file space
sqlite3_wal_checkpoint_v2(db, NULL, SQLITE_CHECKPOINT_TRUNCATE)

// After TRUNCATE checkpoint:
//   - All committed pages are in the main database file
//   - WAL file is truncated to zero bytes
//   - mxFrame resets to 0
//   - New WAL header (with fresh salts) will be written on next write
confirmedMxFrame = 0

// Persist confirmedVersion (survives browser restart)
persistMeta({ confirmedVersion, pageSize })
```

### Auto-checkpoint is disabled

We set `PRAGMA wal_autocheckpoint=0` on connection open. SQLite's default auto-checkpoint (at
1000 WAL frames) is disabled because it could checkpoint optimistic frames, making them
irreversible.

---

## 6. Server Checkpointing

### When it happens

The server can checkpoint freely at any time. It has no optimistic frames—every write on the
server is immediately canonical. Checkpointing is always safe.

Recommended strategies:

- Checkpoint after every commit (simplest, keeps WAL small)
- Checkpoint after every N commits (e.g., N=10, amortizes checkpoint cost)
- Checkpoint when WAL exceeds a frame count threshold

```
// After processing a commit:
if shouldCheckpoint():
  sqlite3_wal_checkpoint_v2(db, NULL, SQLITE_CHECKPOINT_TRUNCATE)
```

### Independence from the frame log

**Server checkpointing and the frame log are completely independent.** This is a critical design
point.

- The server's live WAL (`database.db-wal`) is an ephemeral working file for SQLite's write
  machinery. It is truncated on checkpoint.
- The frame log (in R2/S3) is a separate, append-only archive of committed page records. It is
  NOT the server's live WAL. It is NOT affected by server checkpointing.

The flow for each server commit:

```
SQL COMMIT
  → WAL frames appear in server's live WAL
  → Page records are CAPTURED from those frames
  → Page records are WRITTEN to the frame log (R2/S3, durable)
  → Server may checkpoint its live WAL (independent of frame log)
```

Server checkpointing does not delete or modify frame log entries. The frame log has its own
retention policy.

### Frame log retention and cleanup

The frame log stores committed page records with a configurable retention window (default:
7 days).

Cleanup (runs periodically, e.g., daily):

```
cutoffTimestamp = now - retentionWindow
cutoffVersion = frameLog.findVersionAtTimestamp(cutoffTimestamp)
frameLog.deleteSegmentsBefore(cutoffVersion)
```

After cleanup, clients with `confirmedVersion < cutoffVersion` will receive a full snapshot instead of
a delta on their next sync.

### Snapshot creation for R2

The server periodically creates full database snapshots in R2 for fast full-sync responses:

```
sqlite3_wal_checkpoint_v2(db, NULL, SQLITE_CHECKPOINT_TRUNCATE)
dbBytes = readFile("database.db")
await r2.put(`databases/${dbId}/snapshots/${currentVersion}`, dbBytes)
```

Recommended frequency: after every ~100 commits or when the latest snapshot is older than
1 hour. Keep the 2–3 most recent snapshots; delete older ones.

---

## Frame Log Storage

### Segment structure

The frame log stores committed page records in **segments** in R2/S3. Each segment contains one
or more consecutive commits.

**R2 key pattern:** `databases/{db_id}/frame-log/{first_version:020d}`

Zero-padded version in the key enables lexicographic ordering and efficient LIST/range queries.

### Segment binary format

```
Segment Header (16 bytes):
  Offset  Size  Field
  0       4     magic = 0x414C4653 ("ALFS" — Alpine Frame Segment)
  4       2     version (uint16 BE, currently 1)
  6       4     pageSize (uint32 BE)
  10      4     commitCount (uint32 BE)
  14      2     reserved = 0

Commit entries (repeated commitCount times):
  Offset  Size  Field
  +0      8     version (uint64 BE)
  +8      8     timestampMs (uint64 BE, Unix epoch milliseconds)
  +16     4     dbSize (uint32 BE, database size in pages after this commit)
  +20     2     frameCount (uint16 BE)
  +22     —     Page records (repeated frameCount times):
                  +0   4     pgno (uint32 BE)
                  +4   var   pageData (pageSize bytes)
```

**Example sizing** (pageSize = 4096, commit touching 5 pages):

```
Segment header:        16 bytes
Commit header:         22 bytes
5 page records:     5 × (4 + 4096) = 20,500 bytes
Total for 1 commit: 20,538 bytes ≈ 20 KB
```

A segment with 50 such commits ≈ 1 MB.

### Segment flush policy

The server buffers commits in memory and flushes to R2 when:

- Buffer size ≥ 1 MB, OR
- ≥ 10 seconds since the first buffered commit, OR
- Server is shutting down

### Reading segments for delta sync

```
1. LIST databases/{db_id}/frame-log/ with start-after based on client version
2. For each relevant segment object:
   a. GET the segment from R2
   b. Parse the binary format
   c. Extract commits with version > client's confirmedVersion
   d. Stream to client as Commit (0x11) messages
```

---

## Client WAL Manipulation

These operations require custom C API extensions in our SQLite WASM build. They are the
low-level building blocks that the higher-level sync operations call.

### Required custom C API extensions

```c
// Get current mxFrame value.
unsigned int alpine_wal_get_mx_frame(sqlite3 *db);

// Inject externally-sourced page records into the local WAL.
// Writes WAL frames at positions after current mxFrame.
// Computes local checksums and uses local salt values.
// Advances mxFrame by frameCount.
// Invalidates page cache for affected pages.
// The last injected frame gets db_size_after_commit = dbSize.
int alpine_wal_inject(
  sqlite3 *db,
  int frameCount,
  const AlpinePageRecord *frames,  // [{pgno, pageData}, ...]
  unsigned int dbSize
);

// Revert WAL visibility to targetMxFrame.
// Frames after targetMxFrame become invisible to reads.
// Invalidates page cache (all pages, conservatively).
// Does NOT truncate the WAL file—frames past mxFrame are
// simply invisible and will be overwritten by future writes.
int alpine_wal_revert(
  sqlite3 *db,
  unsigned int targetMxFrame
);

// Capture page records produced by the most recent committed
// write transaction. Called after sqlite3_exec() to record
// optimistic frame count or to extract frames for the frame log.
int alpine_wal_capture_last_tx(
  sqlite3 *db,
  AlpinePageRecord **frames,  // Output: array of page records
  int *frameCount              // Output: number of frames
);
```

### Frame injection byte-level procedure

When `alpine_wal_inject` writes frames into the local WAL file:

```
writeOffset = 32 + confirmedMxFrame × (24 + pageSize)

for i = 0 to frameCount - 1:
  // Build WAL frame header (24 bytes)
  pgno                 = frames[i].pgno
  db_size_after_commit = (i == frameCount - 1) ? dbSize : 0
  salt1                = walHeader.salt1      // From local WAL header
  salt2                = walHeader.salt2

  // Compute checksum continuing chain from previous frame
  if confirmedMxFrame + i == 0:
    prevCksum = walHeader.cksum   // Chain starts from WAL header checksum
  else:
    prevCksum = previousFrame.cksum

  (cksum1, cksum2) = walChecksum(
    prevCksum,
    [pgno, db_size_after_commit],  // Frame header first 8 bytes
    frames[i].pageData             // Full page data
  )

  // Write frame to WAL file
  frameHeader = pack(pgno, db_size_after_commit, salt1, salt2, cksum1, cksum2)
  walFile.write(writeOffset, frameHeader)            // 24 bytes
  walFile.write(writeOffset + 24, frames[i].pageData) // pageSize bytes
  writeOffset += 24 + pageSize

// Advance mxFrame
mxFrame += frameCount

// Invalidate page cache for all injected pages
for each frame in frames:
  invalidatePageCache(frame.pgno)
```

The checksum algorithm is the standard SQLite WAL checksum (see `sqlite_wal_format.md` §
Checksum Algorithm). Checksum byte order is determined by the WAL header magic value.

### Frame revert procedure

```
// Set mxFrame back to confirmed boundary
mxFrame = targetMxFrame

// Conservatively invalidate entire page cache.
// (We could track which pages were in optimistic frames and
// invalidate selectively, but full invalidation is simpler
// and correctness-critical.)
invalidateAllPageCache()

// The WAL file is NOT truncated. Frames past mxFrame are
// invisible to SQLite reads and will be overwritten when
// new frames are injected or written.
```

### Why WAL checksums and salts are local-only

WAL checksums form a cumulative chain starting from the WAL header. Each client has its own WAL
file with its own header, salt values, and checksum chain. Transmitting checksums over the wire
would be meaningless—the recipient would need to recompute them anyway to match its local chain.

The wire format therefore transmits only the essential data: `(pgno, pageData)` pairs. Salt
values and checksums are computed locally during frame injection.

---

## Invariants and Safety Properties

1. **Version monotonicity.** The server assigns versions in strictly increasing order. Commit
   messages arrive in version order on each WebSocket connection.

2. **Server authority.** The server's frames are always canonical. Client optimistic frames are
   always replaced by server frames, even when no intervening commits occurred, because SQL can
   be non-deterministic.

3. **Checkpoint safety.** The client NEVER checkpoints while `pendingCommits` is non-empty.
   Optimistic frames must remain revertible.

4. **Page size immutability.** All clients and the server use the same page size for a given
   database, fixed at creation time.

5. **Checksum/salt locality.** WAL checksums and salt values are never transmitted over the wire.
   Each client computes its own checksum chain locally during frame injection.

6. **Frame log durability before broadcast.** The server writes to the frame log before
   broadcasting Commit messages. Any commit a client receives can be retrieved during backfill.

7. **Idempotent delta sync.** If a client receives a Commit with `version ≤ confirmedVersion` (possible
   edge case during reconnection), it skips the message.

8. **No optimistic state survives reconnection.** On disconnect, the client reverts to confirmed
   state and clears `pendingCommits`. This simplifies the reconnection protocol—no need for
   at-most-once commit tracking across connections.

9. **Rebase correctness.** Re-executing pending SQL during rebase may produce different results
   (different pages affected, different frame count, or failure). All outcomes are valid—the
   re-execution reflects the true state of the database after applying the intervening server
   commit.

10. **Single-writer server.** The server processes one CommitRequest at a time per database.
    Version assignment, frame log write, and broadcast are serialized. No concurrent write conflicts
    on the server.
