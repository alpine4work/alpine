# Databases: Technical Specification (Codex Draft)

This document is a concrete, byte-level `v1` specification for Alpine realtime
SQLite sync. It is intentionally aligned with:

- `shared/databases/meta/databases_technical_vision.md`
- `shared/databases/meta/sqlite_wal_format.md`

This spec covers six operations:

1. Client commit (optimistic, rebase, canonical finalize)
2. Server commit (apply SQL, persist, fanout, archive)
3. Client initialization (snapshot + WAL tail)
4. Client backfill (disconnect/reconnect delta sync)
5. Client checkpointing
6. Server checkpointing

## Normative conventions

- All fixed-width integers are unsigned and **big-endian** unless stated
  otherwise.
- `u8/u16/u32/u64` mean 1/2/4/8-byte unsigned integers.
- `i64` is 8-byte two's-complement signed integer.
- `f64` is IEEE754 64-bit float in big-endian byte order.
- `bytes[n]` is exactly `n` raw bytes.
- `varbytes` fields are encoded as `u32 len` + `len` bytes.
- Strings are UTF-8 bytes (no NUL terminator).
- "MUST", "SHOULD", and "MAY" are normative.

## Global invariants

- One canonical server writer per database (serialized commit order).
- Page size is pinned per database at creation and MUST never change.
- SQLite WAL format version MUST be `3007000`.
- Client and server MUST run WAL mode with `locking_mode=EXCLUSIVE`.
- `PRAGMA wal_autocheckpoint=0` on both client and server.
- Server commit order is defined by monotonically increasing `serverCommitVersion`.
- Server frame order is defined by monotonically increasing `serverFrameVersion`.
- `serverFrameVersion` is logical and does not reset when live WAL resets.

## Binary primitives

### Realtime envelope (WebSocket binary frame)

Every websocket message is one binary frame:

| Offset | Size | Field             | Notes |
| -----: | ---: | ----------------- | ----- |
|      0 |    4 | magic             | ASCII `ALDB` (`0x414c4442`) |
|      4 |    1 | protocol_version  | `0x01` |
|      5 |    1 | message_type      | See table below |
|      6 |    2 | flags             | Bitfield |
|      8 |    4 | payload_len       | Bytes after header |
|     12 |    8 | request_id        | Correlation id, `0` if not request/response |
|     20 |    4 | payload_crc32c    | `0` allowed if omitted |

Header length is fixed at `24` bytes.

`flags` bits:

- `0x0001`: payload is zstd-compressed
- all other bits reserved and MUST be `0` in `v1`

Message types:

| Type | Name                 |
| ---: | -------------------- |
| 0x01 | `ClientHello`        |
| 0x02 | `ServerHello`        |
| 0x03 | `ClientCommitRequest`|
| 0x04 | `ServerCommitApplied`|
| 0x05 | `ServerCommitRejected` |
| 0x06 | `BackfillBegin`      |
| 0x07 | `BackfillChunk`      |
| 0x08 | `BackfillEnd`        |
| 0x09 | `SnapshotRequired`   |
| 0x0a | `Ping`               |
| 0x0b | `Pong`               |

### SQL value encoding

`SqlValue` encoding for statement parameters and result cells:

| Tag | Type        | Payload |
| --: | ----------- | ------- |
| 0x00 | `NULL`     | none |
| 0x01 | `INTEGER`  | `i64` |
| 0x02 | `REAL`     | `f64` |
| 0x03 | `TEXT`     | `varbytes` (UTF-8) |
| 0x04 | `BLOB`     | `varbytes` |
| 0x05 | `BOOLEAN_TRUE`  | none |
| 0x06 | `BOOLEAN_FALSE` | none |

### Statement batch encoding

`StatementBatch`:

| Offset | Size | Field           |
| -----: | ---: | --------------- |
|      0 |    2 | statement_count |
|      2 |    2 | reserved (`0`)  |
|      4 |    4 | statements_len  |
|      8 |   ...| statement records |

Each statement record:

| Offset | Size | Field            |
| -----: | ---: | ---------------- |
|      0 |    4 | record_len       |
|      4 |    4 | sql_utf8_len     |
|      8 |    2 | bind_count       |
|     10 |    2 | statement_flags  |
|     12 |   ...| sql_utf8 bytes   |
|   ...  |   ...| bind records     |

`statement_flags` bits:

- `0x0001`: caller requests statement result rows

Bind record format:

| Offset | Size | Field       |
| -----: | ---: | ----------- |
|      0 |    2 | bind_index  |
|      2 |    1 | value_tag   |
|      3 |    1 | reserved    |
|      4 |    4 | value_len   |
|      8 |   ...| value bytes |

`value_len` MUST be `0` for tags without payload.

## Commit bundle (canonical mutation payload)

`CommitBundle` is the canonical payload for realtime fanout, backfill, and WAL
archive records.

### Commit bundle header (`112` bytes)

| Offset | Size | Field                          |
| -----: | ---: | ------------------------------ |
|      0 |    4 | bundle_magic (`ACMT`)          |
|      4 |    2 | bundle_version (`1`)           |
|      6 |    2 | header_len (`112`)             |
|      8 |    8 | server_commit_version               |
|     16 |    8 | prev_server_commit_version          |
|     24 |    8 | first_server_frame_version          |
|     32 |    4 | frame_count                    |
|     36 |    4 | page_size                      |
|     40 |    4 | wal_epoch                      |
|     44 |    4 | wal_header_magic               |
|     48 |    4 | wal_header_version             |
|     52 |    4 | wal_checkpoint_seq             |
|     56 |    4 | wal_salt1                      |
|     60 |    4 | wal_salt2                      |
|     64 |    4 | checksum_seed_1                |
|     68 |    4 | checksum_seed_2                |
|     72 |    4 | final_db_size_pages            |
|     76 |    4 | bundle_flags                   |
|     80 |   16 | originating_client_mutation_id |
|     96 |    4 | statement_results_len          |
|    100 |    4 | frames_crc32c                  |
|    104 |    4 | bundle_crc32c                  |
|    108 |    4 | reserved (`0`)                 |

Variable region:

1. `frame_count * (24 + page_size)` bytes of raw WAL frames (exact SQLite frame
   bytes: 24-byte frame header + page payload)
2. `statement_results_len` bytes (`StatementResults`, below)

`bundle_flags` bits:

- `0x0001`: `originating_client_mutation_id` is set
- `0x0002`: `statement_results_len > 0`

`checksum_seed_1/2`:

- If this commit starts immediately after a WAL reset: seed is WAL header
  checksum (`cksum1/cksum2`).
- Otherwise: seed is checksum of the frame immediately before
  `first_server_frame_version`.

This allows bundle-local checksum verification without requiring previous bundle
bytes.

### Statement results payload

`StatementResults`:

| Offset | Size | Field            |
| -----: | ---: | ---------------- |
|      0 |    2 | statement_count  |
|      2 |    2 | reserved (`0`)   |
|      4 |   ...| statement result records |

Each statement result record:

| Offset | Size | Field              |
| -----: | ---: | ------------------ |
|      0 |    4 | record_len         |
|      4 |    4 | statement_index    |
|      8 |    8 | changes (`i64`)    |
|     16 |    8 | last_insert_rowid (`i64`) |
|     24 |    1 | result_kind        |
|     25 |    3 | reserved           |
|     28 |   ...| optional rowset    |

`result_kind`:

- `0`: no rowset
- `1`: rowset

Rowset encoding when `result_kind=1`:

| Offset | Size | Field         |
| -----: | ---: | ------------- |
|      0 |    2 | column_count  |
|      2 |    2 | reserved      |
|      4 |   ...| column names  |
|   ...  |    4 | row_count     |
|   ...  |   ...| row cells (`SqlValue`, row-major) |

Each column name is `u16 name_len + name_len bytes`.

## Snapshot + WAL archive artifacts

### Snapshot manifest (`128` bytes)

| Offset | Size | Field                   |
| -----: | ---: | ----------------------- |
|      0 |    4 | magic (`ASNP`)          |
|      4 |    2 | version (`1`)           |
|      6 |    2 | header_len (`128`)      |
|      8 |   16 | snapshot_id             |
|     24 |    8 | snapshot_commit_version      |
|     32 |    8 | snapshot_frame_version       |
|     40 |    4 | page_size               |
|     44 |    4 | wal_epoch               |
|     48 |    4 | wal_salt1               |
|     52 |    4 | wal_salt2               |
|     56 |    8 | snapshot_size_bytes     |
|     64 |   32 | snapshot_sha256         |
|     96 |    8 | created_at_unix_ms      |
|    104 |    8 | expires_at_unix_ms      |
|    112 |   16 | reserved (`0`)          |

Snapshot content is a raw SQLite main-db file (`.sqlite`) at
`snapshot_commit_version`.

### WAL archive segment object (S3/R2)

Each immutable segment object stores append-only commit bundles.

Segment header (`64` bytes):

| Offset | Size | Field                |
| -----: | ---: | -------------------- |
|      0 |    4 | magic (`ASEG`)       |
|      4 |    2 | version (`1`)        |
|      6 |    2 | header_len (`64`)    |
|      8 |    8 | first_commit_version      |
|     16 |    8 | last_commit_version       |
|     24 |    8 | first_frame_version       |
|     32 |    8 | last_frame_version        |
|     40 |    4 | page_size            |
|     44 |    4 | record_count         |
|     48 |    4 | segment_crc32c       |
|     52 |   12 | reserved (`0`)       |

Records follow immediately:

| Offset | Size | Field                  |
| -----: | ---: | ---------------------- |
|      0 |    4 | record_len             |
|      4 |    4 | record_crc32c          |
|      8 |   ...| `CommitBundle` bytes   |

`record_len` includes the 8-byte record prefix.

## Operation 1: Client commit

### Request payload: `ClientCommitRequest`

| Offset | Size | Field                |
| -----: | ---: | -------------------- |
|      0 |   16 | client_mutation_id   |
|     16 |    8 | base_commit_version       |
|     24 |    8 | base_frame_version        |
|     32 |    4 | statement_batch_len  |
|     36 |    4 | request_flags        |
|     40 |   ...| `StatementBatch`     |

`request_flags` bits:

- `0x0001`: request statement results

### Client-side algorithm

For `v1`, each database worker allows at most one in-flight mutation.

1. Client executes the statement batch locally in one SQLite transaction.
2. Client records optimistic WAL span:
   - `optimisticStartFrameVersion`
   - `optimisticFrameCount`
3. Client sends `ClientCommitRequest`.
4. While pending, if a `ServerCommitApplied` for another commit arrives:
   - revert optimistic span (`rewind to optimisticStartFrameVersion - 1`)
   - apply incoming `CommitBundle` frames
   - re-execute original statement batch locally
   - replace optimistic span metadata
5. When `ServerCommitApplied` arrives for this mutation id:
   - revert current optimistic span
   - apply canonical bundle
   - finalize UI data from canonical statement results (if present), else
     re-read locally.
6. If `ServerCommitRejected` arrives:
   - revert optimistic span
   - surface rejection error

### Rejection payload: `ServerCommitRejected`

| Offset | Size | Field                     |
| -----: | ---: | ------------------------- |
|      0 |   16 | client_mutation_id        |
|     16 |    8 | base_commit_version            |
|     24 |    4 | application_error_code    |
|     28 |    4 | sqlite_extended_error     |
|     32 |    1 | retryable (`0/1`)         |
|     33 |    3 | reserved                  |
|     36 |    4 | message_len               |
|     40 |   ...| UTF-8 error message       |

## Operation 2: Server commit

### Canonical commit pipeline

For each `ClientCommitRequest`, server performs:

1. Parse and validate statement batch bytes.
2. Serialize against the database writer queue.
3. Execute all statements in one SQLite transaction.
4. Capture canonical frame span and build `CommitBundle`.
5. Durably append bundle to WAL archive segment (S3/R2).
6. Durably record commit head (`serverCommitVersion`, `serverFrameVersion`) in metadata.
7. Publish `ServerCommitApplied` (`CommitBundle`) to all subscribed clients in
   commit order.
8. Return success to originator via same `ServerCommitApplied` payload (with
   `originating_client_mutation_id` and optional statement results).

If SQLite execution fails, server sends `ServerCommitRejected` and does not
append to archive.

### Realtime update format

Realtime update to all clients is exactly:

- message type: `ServerCommitApplied` (`0x04`)
- payload: raw `CommitBundle` bytes

No second format exists for fanout vs originator; both use `CommitBundle`.

## Operation 3: Client initialization

### Handshake payload: `ClientHello`

| Offset | Size | Field                  |
| -----: | ---: | ---------------------- |
|      0 |   16 | database_id            |
|     16 |   16 | client_session_id      |
|     32 |    8 | resume_commit_version       |
|     40 |    8 | resume_frame_version        |
|     48 |    4 | known_page_size        |
|     52 |    4 | known_wal_epoch        |
|     56 |    4 | pending_mutation_count |
|     60 |    4 | hello_flags            |
|     64 |   ...| pending mutation ids (`16 * count`) |

`hello_flags` bits:

- `0x0001`: local snapshot exists

### `ServerHello` payload

| Offset | Size | Field                    |
| -----: | ---: | ------------------------ |
|      0 |    8 | head_commit_version           |
|      8 |    8 | head_frame_version            |
|     16 |    8 | retention_start_commit_version|
|     24 |    4 | page_size                |
|     28 |    4 | wal_epoch                |
|     32 |    1 | sync_mode                |
|     33 |    3 | reserved                 |
|     36 |    8 | delta_from_commit_version     |
|     44 |    8 | delta_to_commit_version       |
|     52 |    4 | server_flags             |

`sync_mode`:

- `0`: resume realtime immediately (no gap)
- `1`: delta backfill required (`delta_from_commit_version..delta_to_commit_version`)
- `2`: snapshot required (server sends `SnapshotRequired` next)

### `SnapshotRequired` payload

`SnapshotRequired` payload is:

1. 128-byte `SnapshotManifest`
2. `u16 snapshot_path_len + snapshot_path bytes` (UTF-8 API path)

Initialization procedure when snapshot is required:

1. Download snapshot bytes from `snapshot_path`.
2. Verify byte length and SHA-256 against manifest.
3. Atomically write snapshot file to OPFS (`db.sqlite`).
4. Open SQLite connection and set:
   - `PRAGMA journal_mode=WAL`
   - `PRAGMA locking_mode=EXCLUSIVE`
   - `PRAGMA wal_autocheckpoint=0`
5. If `head_commit_version > snapshot_commit_version`, run backfill from
   `snapshot_commit_version + 1`.
6. Enter realtime mode.

## Operation 4: Client backfill (reconnect)

### `BackfillBegin` payload

| Offset | Size | Field               |
| -----: | ---: | ------------------- |
|      0 |    8 | from_commit_version      |
|      8 |    8 | to_commit_version        |
|     16 |    8 | expected_total_bytes|
|     24 |    4 | chunk_count         |
|     28 |    4 | flags               |

### `BackfillChunk` payload

| Offset | Size | Field               |
| -----: | ---: | ------------------- |
|      0 |    8 | first_commit_version     |
|      8 |    8 | last_commit_version      |
|     16 |    4 | bundle_count        |
|     20 |    4 | bundles_len         |
|     24 |   ...| bundle entries      |

Each bundle entry:

| Offset | Size | Field             |
| -----: | ---: | ----------------- |
|      0 |    4 | bundle_len        |
|      4 |   ...| `CommitBundle`    |

### `BackfillEnd` payload

| Offset | Size | Field            |
| -----: | ---: | ---------------- |
|      0 |    8 | final_commit_version  |
|      8 |    8 | final_frame_version   |
|     16 |    4 | status (`0=ok`)  |
|     20 |    4 | reserved         |

### Backfill algorithm

1. Client reconnects and sends `ClientHello` with local resume point.
2. If resume point is within retention:
   - server returns `sync_mode=1`
   - server sends `BackfillBegin` + one or more `BackfillChunk` + `BackfillEnd`
3. Client applies each `CommitBundle` in strict order:
   - verify contiguous `server_commit_version`
   - verify `prev_server_commit_version`
   - verify `frames_crc32c` and WAL checksum chain
   - apply WAL frames to local DB
4. After `BackfillEnd(status=0)`, client resume point MUST equal server head.
5. If resume point is older than retention, server uses `sync_mode=2` and
   snapshot flow instead of delta.

For long disconnects (for example one day), the data downloaded is always:

- either contiguous `CommitBundle` bytes from WAL archive (delta path)
- or one snapshot DB file plus contiguous `CommitBundle` tail

No SQL re-execution is used for backfill.

## Operation 5: Client checkpointing

### Safety rule

Client MUST NOT checkpoint while optimistic WAL frames exist.

### Trigger policy (`v1`)

Run `sqlite3_wal_checkpoint_v2(..., SQLITE_CHECKPOINT_TRUNCATE)` only when:

- `pending_mutation_count == 0`
- and at least one trigger is true:
  - local WAL bytes `>= 16 MiB`
  - confirmed server frames since last checkpoint `>= 4096`
  - `>= 120s` since last checkpoint and client is idle/hidden

During large backfills, client SHOULD checkpoint every `8192` applied server
frames (still only when no pending mutation exists).

## Operation 6: Server checkpointing

### Safety and ordering

Before checkpointing live canonical SQLite WAL, server MUST ensure all commits
through current head are durably archived in WAL segment objects.

### Trigger policy (`v1`)

Server runs checkpoint when any condition is true:

- live WAL bytes `>= 256 MiB`
- live WAL frames `>= 65536`
- `>= 300s` since last checkpoint

Recommended mode:

1. `SQLITE_CHECKPOINT_RESTART` for normal cycle
2. periodic `SQLITE_CHECKPOINT_TRUNCATE` (for example every 15 minutes) to
   shrink file size

### Interaction with full WAL archive

- Server live WAL reset/truncate changes WAL salt epoch.
- WAL archive is unaffected because it stores immutable `CommitBundle` records
  with explicit `wal_epoch`, salts, and checksum seeds.
- Backfill relies on archive commit order (`server_commit_version`), not live WAL
  byte offsets.
- Archive retention garbage-collects only commits older than configured window
  (for example 30 days), independent of live WAL checkpoints.

## Required validation on apply

Client and server MUST reject any `CommitBundle` that fails one of:

- invalid `bundle_magic` / `bundle_version`
- page size mismatch with local DB
- non-contiguous `server_commit_version`
- non-contiguous `first_server_frame_version`
- `frame_count == 0`
- final frame has `db_size_after_commit == 0`
- frame salts mismatch declared `wal_salt1/2`
- WAL checksum chain mismatch from `checksum_seed_1/2`
- `frames_crc32c` mismatch
- `bundle_crc32c` mismatch

Rejecting malformed bundles prevents silent divergence.

## Notes for implementation

- This spec intentionally uses one canonical binary mutation unit
  (`CommitBundle`) across realtime fanout, backfill, and archive.
- Client commit requests are logical SQL; all server-to-client state transfer is
  physical WAL-frame based.
- This preserves deterministic convergence while still giving low-latency
  optimistic local UX.
