# SQLite WAL Format (Implementation Reference)

This document is a practical, byte-level reference for the exact SQLite WAL
format we need to reason about for Alpine realtime semantics.

It focuses on:

- `-wal` on-disk format (cross-platform)
- exclusive-locking behavior (important for WASM/OPFS)
- invariants that matter for frame streaming, injection, rebase, and rollback

## Scope and Version Constants

SQLite currently defines:

- WAL file format version: `3007000`

That value is explicitly enforced in SQLite's WAL implementation.

## Terminology: "Commit" In This Doc

In this document, `commit` always refers to SQLite SQL transaction commit
semantics, not source-control commits.

- SQL `COMMIT`: ends a write transaction and makes it durable/visible if it
  succeeds.
- WAL commit frame: a frame where `db_size_after_commit != 0`; this marks the
  end of a committed SQL write transaction in the WAL stream.
- Source-control commit (Git): unrelated to WAL format; never what this doc
  means.

## Terminology: `mxFrame`

`mxFrame` is the frame-number boundary for WAL visibility.

- Definition: largest WAL frame index considered visible for a given reader
  snapshot.
- Purpose: gives readers a stable "end mark" so they do not see newer frames
  appended after snapshot start.
- Checkpoint relevance: checkpoint operations backfill frames up to a chosen
  valid commit boundary that is constrained by WAL visibility state.
- Not stored in `X-wal` bytes directly: SQLite derives it from valid commit
  frames/checksums and stores it in WAL runtime metadata.
- Storage in normal WAL mode: runtime metadata in shared-memory wal-index
  state.
- Storage in exclusive locking mode (our setup): runtime metadata in heap
  memory in the owning SQLite connection.

When docs say "frames after `mxFrame` are ignored", it means ignored for that
reader's snapshot visibility.

## Files In WAL Mode

In active WAL mode, SQLite usually uses:

- main DB: `X`
- WAL: `X-wal`

In `PRAGMA locking_mode=EXCLUSIVE` (our mode), WAL behavior still applies but
shared-memory coordination details are not part of the integration surface.

## `-wal` Binary Format

The WAL file is:

1. 32-byte WAL header
2. 0 or more frames

Each frame is:

- 24-byte frame header
- `page_size` bytes of page data

### High-level layout

```text
+-------------------------+ 0
| WAL header (32 bytes)   |
+-------------------------+ 32
| Frame 1 header (24)     |
+-------------------------+ 56
| Frame 1 page data       |  page_size bytes
+-------------------------+
| Frame 2 header (24)     |
+-------------------------+
| Frame 2 page data       |
+-------------------------+
| ...                     |
```

Frame index is 1-based.

Offset formula for frame `i` (1-based):

```text
frame_offset(i) = 32 + (i - 1) * (24 + page_size)
```

Total WAL size with `n` frames:

```text
wal_size(n) = 32 + n * (24 + page_size)
```

### WAL header (32 bytes, all 32-bit big-endian words)

| Offset | Size | Field | Meaning |
|---:|---:|---|---|
| 0 | 4 | magic | `0x377f0682` or `0x377f0683` |
| 4 | 4 | version | format version, currently `3007000` |
| 8 | 4 | page_size | DB page size in bytes |
| 12 | 4 | checkpoint_seq | checkpoint sequence counter |
| 16 | 4 | salt1 | salt epoch value |
| 20 | 4 | salt2 | salt epoch value |
| 24 | 4 | cksum1 | checksum over first 24 header bytes |
| 28 | 4 | cksum2 | checksum over first 24 header bytes |

Magic value controls checksum byte-order interpretation:

- `0x377f0682`: checksum input words interpreted as little-endian
- `0x377f0683`: checksum input words interpreted as big-endian

Checksum words stored in WAL are always written as big-endian.

### Frame header (24 bytes, all 32-bit big-endian words)

| Offset | Size | Field | Meaning |
|---:|---:|---|---|
| 0 | 4 | pgno | database page number (`>0`) |
| 4 | 4 | db_size_after_commit | non-zero on SQL txn commit frame (DB pages) |
| 8 | 4 | salt1 | copy of WAL header salt1 |
| 12 | 4 | salt2 | copy of WAL header salt2 |
| 16 | 4 | cksum1 | rolling checksum after this frame |
| 20 | 4 | cksum2 | rolling checksum after this frame |

`db_size_after_commit != 0` marks an SQL transaction commit frame.

### Frame page data payload (`page_size` bytes)

The page-data region is a full database page image for `pgno`, not a row-level
or cell-level diff.

For WAL application semantics, treat frame payload as:

```text
database_page[pgno] = wal_frame.page_data
```

subject to SQL-commit visibility (`mxFrame`, defined above) and checksum/salt
validity.

What can appear in frame page data:

- Any normal SQLite database page type from the main DB format.
- For `pgno=1`, bytes `0..99` are the 100-byte database file header.
- B-tree pages (table/index, interior/leaf), overflow pages, freelist pages.
- Pointer-map pages when auto-vacuum/incremental-vacuum is enabled.
- Reserved bytes at end-of-page (if configured) are included verbatim.

Common b-tree page type bytes:

- `0x02` interior index page
- `0x05` interior table page
- `0x0a` leaf index page
- `0x0d` leaf table page

Implication for replication: WAL payload should be handled as opaque
`page_size` bytes unless we intentionally build page-level introspection tools.

## Valid Frame Rules

A frame is valid only if:

1. frame salts match WAL header salts
2. page number is non-zero
3. checksum chain matches

Checksum chain covers, in order:

- WAL header first 24 bytes
- for each frame: frame header first 8 bytes + frame page data

The per-frame salt fields and per-frame checksum fields are not included in that
frame's checksum input.

## Checksum Algorithm

Treat input as an even-length sequence of 32-bit words `x[0..N]`:

```text
s0 = s1 = 0
for j = 0 .. (word_count/2 - 1):
  s0 = s0 + x[2*j] + s1
  s1 = s1 + x[2*j + 1] + s0
```

For frame `k`, `(s0,s1)` starts from frame `k-1` checksum (or WAL header
checksum for first frame), then extends with frame `k` input.

All adds are unsigned 32-bit with wraparound.

## SQL Commit, Snapshot, Recovery Semantics

- WAL can contain multiple SQL write transactions.
- Readers take an end mark at last valid SQL commit frame (`mxFrame`) and ignore
  newer frames.
- Recovery scans WAL from start, stops at first invalid checksum (or EOF), and
  sets `mxFrame` to the last valid SQL commit frame.
- Frames after `mxFrame` are ignored for visibility.

Simple transaction boundary view:

```text
Frame:  1    2    3    4    5    6
dbsz:   0    0   100   0    0   103
Txn:         TXN A           TXN B
```

## Checkpointing and WAL File Evolution

Checkpointing moves SQL-committed state from `X-wal` back into the main DB
file.

Operationally:

1. Choose a checkpoint target frame (an SQL commit boundary).
2. For each page number, apply the latest frame at or before that target.
3. Sync DB pages per checkpoint mode requirements.

Important: checkpointing updates main DB durability, but it does not require
rewriting or immediately deleting existing WAL frames.

Simple lifecycle sketch:

```text
append frames -> checkpoint backfills pages -> WAL may still contain frames
             -> reset/restart point reached -> WAL reuses frame slot #1
             -> optional truncate-to-zero
```

### Checkpoint modes (practical behavior)

- `PASSIVE`: attempt checkpoint without blocking readers/writers; may be partial.
- `FULL`: wait for writers/readers as needed to checkpoint all possible frames.
- `RESTART`: like `FULL`, plus ensure next writer restarts WAL at frame 1.
- `TRUNCATE`: like `RESTART`, plus truncate WAL file to 0 bytes on success.

### Reset and salt epochs

When WAL is restarted from frame 1, SQLite writes a new WAL header epoch:

- `salt1` increments
- `salt2` is re-randomized

This invalidates stale older-epoch frame bytes that may still exist in the file
tail.

### Checkpointing and commit visibility

- Readers only see frames up to their chosen end mark (`mxFrame`).
- A checkpoint may backfill many pages while readers continue.
- Uncheckpointed SQL-committed frames can remain in WAL and still be valid for
  readers until reset/truncate conditions are met.

## Exclusive Locking Mode and WASM

In exclusive locking mode:

- no shared-memory `-shm` file is part of the required runtime contract

Important for us:

- To run WAL in SQLite WASM/OPFS, SQLite documents setting
  `PRAGMA locking_mode=EXCLUSIVE` immediately after open, before first WAL
  access.
- This enables WAL semantics without shared-memory primitives, but with no
  concurrency benefits (single-owner semantics).

## Implications For Alpine Realtime WAL Replication

For frame-level replication and optimistic rebase, the hard invariants are:

1. Page size must be identical on server and clients.
2. Frame order must be preserved exactly.
3. Checksum chain must stay valid across injected/replayed frames.
4. Salt epoch transitions (WAL reset) must be tracked; old-epoch frames are
   invalid against new header salts.
5. SQL transaction boundaries come only from commit frames
   (`db_size_after_commit != 0`).
6. Rewind/rebase logic must preserve coherent `mxFrame` visibility semantics.
7. Auto-checkpoint should be disabled during speculative periods where rollback
   of optimistic frames may be needed.

## References

- [SQLite Database File Format (`fileformat.html`)](https://www.sqlite.org/fileformat.html)
- [SQLite WAL-mode File Format (`walformat.html`)](https://www.sqlite.org/walformat.html)
- [SQLite WAL Overview (`wal.html`)](https://www.sqlite.org/wal.html)
- [SQLite source: `src/wal.c` (canonical implementation details)](https://www.sqlite.org/src/doc/tip/src/wal.c)
- [SQLite PRAGMA docs (`wal_autocheckpoint`, `wal_checkpoint`)](https://www.sqlite.org/pragma.html)
- [SQLite C API: `sqlite3_wal_checkpoint_v2()`](https://www.sqlite.org/c3ref/wal_checkpoint_v2.html)
- [SQLite C API: `sqlite3_wal_autocheckpoint()`](https://www.sqlite.org/c3ref/wal_autocheckpoint.html)
- [SQLite WASM persistence docs (WAL with OPFS)](https://sqlite.org/wasm/doc/tip/persistence.md)
