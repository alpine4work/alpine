# Databases Realtime Synchronization Technical Specification (Codex)

This document specifies the high level realtime synchronization operations for
Alpine databases so another agent can implement the code directly.

It is based on:

- `shared/databases/meta/databases_technical_vision.md`
- `shared/databases/meta/sqlite_wal_format.md`

## Naming Requirements For Implementation

- For monotonically increasing integers, use `version` in symbol names.
- Avoid abbreviations in symbol names.
- Prefer long explicit names like `clientGeneratedCommitIdentifier`.
- Keep protocol field names and storage metadata names explicit and readable.

## Scope

This specification covers:

1. client commit lifecycle with optimistic writes and rebase
2. server commit lifecycle with persistence and broadcast
3. client initialization from snapshot and write ahead log
4. reconnect backfill after short or long disconnection
5. client checkpointing policy
6. server checkpointing policy and interaction with backfill retention

This specification assumes one SQLite connection per database process, in
exclusive locking mode, with write ahead log enabled.

## Shared State Model

### Required Versions

- `databaseVersion`: canonical committed transaction version on the server.
  - Increments by exactly `1` for each committed write transaction.
- `confirmedDatabaseVersion`: highest `databaseVersion` that a client has
  confirmed from server messages.
- `snapshotDatabaseVersion`: `databaseVersion` represented by a snapshot file.
- `writeAheadLogEpochVersion`: version that increments whenever the live
  server write ahead log is reset to frame `1` after checkpoint restart.

### Required Invariants

- Server is the only canonical writer.
- All commits are applied in strict `databaseVersion` order.
- Same page size must be used by server and all clients for one database.
- Write ahead log frame salts and rolling checksums must validate before apply.
- Client must disable automatic checkpointing.
- Client must not checkpoint while any optimistic commit is pending.
- Server backfill reads must come from archived write ahead log data, not from
  the current live `-wal` file.

## Protocol Contracts

These are logical contracts. Binary transport optimization is allowed later,
but the same fields and semantics must be preserved.

### Client To Server Commit Request

```ts
type ClientCommitRequest = {
  messageType: "clientCommitRequest";
  databaseIdentifier: string;
  clientConnectionIdentifier: string;
  clientGeneratedCommitIdentifier: string;
  baseDatabaseVersion: number;
  structuredQueryLanguageStatementList: string[];
  structuredQueryLanguageParameterValueListByStatement: unknown[][];
};
```

### Server To Client Commit Applied Message (Realtime + Acknowledgement)

```ts
type ServerCommitAppliedMessage = {
  messageType: "serverCommitApplied";
  databaseIdentifier: string;
  databaseVersion: number;
  previousDatabaseVersion: number;
  writeAheadLogEpochVersion: number;
  originatingClientGeneratedCommitIdentifier: string | null;
  committedAtUnixMillisecondTimestamp: number;
  writeAheadLogFramePayloadEncoding: "base64";
  writeAheadLogFramePayload: string;
  writeAheadLogFrameCount: number;
};
```

`writeAheadLogFramePayload` is the canonical commit payload. It contains only
the frames for this single server commit, in frame order.

### Server To Client Commit Rejected Message

```ts
type ServerCommitRejectedMessage = {
  messageType: "serverCommitRejected";
  databaseIdentifier: string;
  clientGeneratedCommitIdentifier: string;
  rejectedAtUnixMillisecondTimestamp: number;
  rejectionReasonCode:
    | "permissionDenied"
    | "constraintViolation"
    | "invalidRequest"
    | "internalFailure";
  rejectionReasonText: string;
};
```

### Client To Server Backfill Request

```ts
type ClientBackfillRequest = {
  messageType: "clientBackfillRequest";
  databaseIdentifier: string;
  confirmedDatabaseVersion: number;
  unresolvedClientGeneratedCommitIdentifierList: string[];
};
```

### Server To Client Backfill Response

```ts
type ServerBackfillResponse =
  | {
      messageType: "serverBackfillDeltaResponse";
      databaseIdentifier: string;
      startingDatabaseVersionExclusive: number;
      endingDatabaseVersionInclusive: number;
      commitList: ServerCommitAppliedMessage[];
      unresolvedClientCommitResolutionList: ClientCommitResolution[];
    }
  | {
      messageType: "serverBackfillSnapshotRequiredResponse";
      databaseIdentifier: string;
      snapshotDatabaseVersion: number;
      snapshotDownloadUniformResourceLocator: string;
      commitListAfterSnapshot: ServerCommitAppliedMessage[];
      unresolvedClientCommitResolutionList: ClientCommitResolution[];
    };

type ClientCommitResolution = {
  clientGeneratedCommitIdentifier: string;
  resolutionType: "committed" | "rejected" | "unknown";
  databaseVersion: number | null;
  rejectionReasonText: string | null;
};
```

## Storage Contracts

Use S3 compatible object storage (for example Cloudflare R2) for durability.

- Snapshot object:
  - key pattern:
    `databases/{databaseIdentifier}/snapshots/{snapshotDatabaseVersion}.sqlite3`
- Write ahead log archive segment object:
  - key pattern:
    `databases/{databaseIdentifier}/write_ahead_log_segments/{startingDatabaseVersion}_{endingDatabaseVersion}.walsegment`
- Write ahead log archive manifest object:
  - key pattern:
    `databases/{databaseIdentifier}/write_ahead_log_manifest.json`
  - includes segment index, byte offsets, checksums, and retention metadata.

The write ahead log archive is append only by `databaseVersion`. Checkpointing
the live server database must not delete archive history that is still inside
retention policy.

## Operation 1: Client Commit Lifecycle

### Preconditions

- Client has an open local SQLite connection and websocket connection.
- Client tracks:
  - `confirmedDatabaseVersion`
  - `pendingClientCommitList`

### Step 1: Initial Optimistic Commit

For a new client write request:

1. Create `clientGeneratedCommitIdentifier`.
2. Record `baseDatabaseVersion = confirmedDatabaseVersion`.
3. Execute statement list locally inside one transaction.
4. Capture produced optimistic write ahead log frame boundary metadata.
5. Add pending item:
   - `clientGeneratedCommitIdentifier`
   - `baseDatabaseVersion`
   - statement list and parameters
   - optimistic frame boundary metadata
6. Send `ClientCommitRequest` to server.

Local reads now show optimistic results immediately.

### Step 2: Rebase On Interleaving Server Commits

If a `ServerCommitAppliedMessage` arrives while the pending list is non-empty
and the message is not the canonical result for the first pending item:

1. Revert pending optimistic commits in reverse pending order.
2. Apply incoming canonical server commit payload.
3. Set `confirmedDatabaseVersion = incoming.databaseVersion`.
4. Re-execute each pending commit in original pending order:
   - execute statements locally
   - capture new optimistic frame boundary metadata
5. If local re-execution fails for a pending commit:
   - remove that pending commit
   - send failure to caller
   - continue with remaining pending commits

This process may run multiple times before a pending commit is confirmed.

### Step 3: Final Canonical Data For The Originating Commit

A pending commit is finalized when either:

- matching `ServerCommitAppliedMessage` arrives with
  `originatingClientGeneratedCommitIdentifier`
- matching `ServerCommitRejectedMessage` arrives

For canonical apply:

1. Revert all pending optimistic commits.
2. Apply canonical server commit payload in strict version order.
3. Remove confirmed pending commit from list.
4. Re-execute any later pending commits on top.
5. Return success with canonical `databaseVersion`.

For rejection:

1. Revert only rejected pending commit plus later pending commits.
2. Remove rejected pending commit from list.
3. Re-execute later pending commits.
4. Return rejection reason to caller.

## Operation 2: Server Commit Lifecycle

### Preconditions

- Server has one serialized commit queue per `databaseIdentifier`.
- Server has one canonical SQLite connection per active database.

### Step 1: Receive And Validate

1. Validate account authorization for the database.
2. Validate request shape and statement count limits.
3. Enqueue request in per database commit queue.

### Step 2: Apply Canonical Commit

Inside queued execution:

1. Start SQLite write transaction.
2. Execute client statement list in order.
3. On failure:
   - rollback transaction
   - send `ServerCommitRejectedMessage` to originating client
   - persist rejection event for reconnect resolution
4. On success:
   - commit transaction
   - extract canonical write ahead log frames for this one commit
   - compute `databaseVersion = previousDatabaseVersion + 1`

### Step 3: Persist Commit Durably

Before broadcasting success:

1. Append commit metadata to database commit metadata store.
2. Append frame payload to write ahead log archive segment in object storage.
3. Update write ahead log archive manifest.
4. Ensure durability acknowledgement from storage layer.

If durability fails, do not publish success. Retry or fail closed.

### Step 4: Realtime Distribution

1. Publish `ServerCommitAppliedMessage` to all connected clients of database.
2. Include `originatingClientGeneratedCommitIdentifier` for the originating
   client only; send `null` for other clients.
3. Maintain strict increasing `databaseVersion` publish order.

### Realtime Update Format Requirement

Realtime update payload is canonical write ahead log frame data for one
committed transaction plus `databaseVersion` metadata. It must not be logical
row patch format and must not be statement replay format.

## Operation 3: Client Initialization

### Trigger

- First database open in browser.
- Existing local database is missing or invalid.

### Steps

1. Request initialization bundle from server.
2. Server returns:
   - latest snapshot descriptor and download link
   - commit list after snapshot up to head version
3. Download snapshot file.
4. Write snapshot file to temporary Origin Private File System path.
5. Atomically move temporary file to active database path.
6. Open SQLite connection against active path.
7. Set required pragmas:
   - `PRAGMA journal_mode=WAL`
   - `PRAGMA locking_mode=EXCLUSIVE`
   - disable automatic checkpointing
8. Apply each post snapshot commit payload in version order.
9. Set:
   - `confirmedDatabaseVersion = latestAppliedDatabaseVersion`
   - `pendingClientCommitList = []`
10. Start realtime stream from `confirmedDatabaseVersion + 1`.

### Validation

Initialization must fail closed if:

- snapshot checksum mismatch
- page size mismatch against runtime expectations
- write ahead log payload checksum or salt validation fails

## Operation 4: Client Backfill After Disconnect And Reconnect

### Trigger

- websocket disconnect followed by reconnect, including long gaps such as one
  day.

### Reconnect Handshake

1. Client reconnects websocket.
2. Client sends `ClientBackfillRequest` with:
   - `confirmedDatabaseVersion`
   - unresolved client commit identifiers

### Server Decision

Server checks whether requested version is inside retained archive window:

- If yes:
  - send `serverBackfillDeltaResponse` containing missing commits from
    `confirmedDatabaseVersion + 1` to current head.
- If no:
  - send `serverBackfillSnapshotRequiredResponse` containing:
    - latest durable snapshot descriptor
    - commit list after snapshot

### Client Apply Rules

For delta response:

1. Revert local pending optimistic commits.
2. Apply missing commits in strict increasing `databaseVersion`.
3. Resolve unresolved client commit identifiers from response.
4. Re-execute still pending optimistic commits, if any.

For snapshot required response:

1. Revert local pending optimistic commits.
2. Replace local Origin Private File System database with new snapshot.
3. Reopen SQLite connection and required pragmas.
4. Apply commits after snapshot.
5. Resolve unresolved client commit identifiers.

For both response types:

- Reject and restart initialization if any version gap is detected.
- End state must have contiguous version history ending at server head version.

## Operation 5: Client Checkpointing Policy

### Rules

- Automatic checkpointing must stay disabled.
- Checkpoint only when `pendingClientCommitList` is empty.
- Checkpoint only when no rebase operation is running.
- Use explicit checkpoint mode that truncates local write ahead log on success.

### Trigger Conditions

Run checkpoint when any condition is true:

- local write ahead log byte size exceeds configured threshold
- confirmed version distance since last checkpoint exceeds configured threshold
- after initialization or backfill completes
- before closing worker during controlled shutdown

Initial threshold recommendation:

- `localWriteAheadLogByteThreshold = 32 * 1024 * 1024`
- `databaseVersionDistanceThreshold = 128`

### Failure Handling

- If checkpoint fails, keep running and retry with backoff.
- Do not block reads or incoming server commit apply on checkpoint failure.

## Operation 6: Server Checkpointing Policy

### Rules

- Server also disables automatic checkpointing.
- Server checkpoints live canonical SQLite files on explicit schedule.
- Backfill correctness must depend on archived write ahead log segments, not
  live `-wal` contents.

### Trigger Conditions

Run server checkpoint when any condition is true:

- live write ahead log byte size exceeds threshold
- elapsed time since last checkpoint exceeds threshold
- committed version distance since last checkpoint exceeds threshold

Initial threshold recommendation:

- `serverLiveWriteAheadLogByteThreshold = 256 * 1024 * 1024`
- `serverCheckpointIntervalMilliseconds = 300000`
- `databaseVersionDistanceThreshold = 1000`

### Interaction With Full Write Ahead Log Backfill Archive

Before checkpoint:

1. Verify all commits up to head `databaseVersion` are durably archived in
   object storage.
2. Persist checkpoint intent metadata with current head version.

During checkpoint:

1. Run checkpoint on live database.
2. If write ahead log resets, increment `writeAheadLogEpochVersion`.

After checkpoint:

1. Persist checkpoint completion metadata.
2. Keep archived segments unchanged except retention compaction rules.

Retention compaction may delete very old archive segments only when:

- a newer snapshot exists
- deleted range is older than retention policy
- no active backfill request needs deleted range

## Required Acceptance Criteria

Implementation is complete when all are true:

1. Concurrent client writes produce deterministic canonical ordering by
   `databaseVersion`.
2. Optimistic commit rebase works across repeated interleaving commits.
3. Disconnect and reconnect after one day succeeds through delta backfill when
   retained versions are available.
4. Disconnect and reconnect older than retention succeeds through snapshot
   replacement and post snapshot replay.
5. Client checkpoint never runs while optimistic commits are pending.
6. Server checkpoint does not break ability to backfill from archived write
   ahead log history inside retention window.
