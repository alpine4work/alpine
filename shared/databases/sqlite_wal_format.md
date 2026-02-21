# SQLite WAL Format (Implementation Reference)

This document is a practical, byte-level reference for the exact SQLite WAL
format we need to reason about for Alpine realtime semantics.

It focuses on:

- `-wal` on-disk format (cross-platform)
- `-shm` wal-index format (unix/windows reference implementation)
- exclusive-locking behavior (important for WASM/OPFS)
- invariants that matter for frame streaming, injection, rebase, and rollback

## Scope and Version Constants

SQLite currently defines:

- WAL file format version: `3007000`
- WAL-index format version: `3007000`

Those values are explicitly enforced in SQLite's WAL implementation.

## Files In WAL Mode

In active WAL mode, SQLite usually uses:

- main DB: `X`
- WAL: `X-wal`
- wal-index: `X-shm`

In `PRAGMA locking_mode=EXCLUSIVE`, SQLite omits `X-shm` and keeps the
wal-index in heap memory.

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
| 4 | 4 | db_size_after_commit | non-zero only on commit frame |
| 8 | 4 | salt1 | copy of WAL header salt1 |
| 12 | 4 | salt2 | copy of WAL header salt2 |
| 16 | 4 | cksum1 | rolling checksum after this frame |
| 20 | 4 | cksum2 | rolling checksum after this frame |

`db_size_after_commit != 0` marks commit frame (transaction boundary).

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

## Commit, Snapshot, Recovery Semantics

- WAL can contain multiple transactions.
- Readers take an end mark at last valid commit frame (`mxFrame`) and ignore
  newer frames.
- Recovery scans WAL from start, stops at first invalid checksum (or EOF), and
  sets `mxFrame` to the last valid commit frame.
- Frames after `mxFrame` are ignored for visibility.

Simple transaction boundary view:

```text
Frame:  1    2    3    4    5    6
Commit: 0    0   100   0    0   103
Txn:         TXN A           TXN B
```

## WAL Reset and Salt Epochs

After checkpointing all visible frames, WAL can be reset/reused from frame 1.
On reset:

- `salt1` increments
- `salt2` is re-randomized

This invalidates stale older-epoch frames left in file tail.

## `-shm` WAL-Index Format (Reference Implementation)

`X-shm` is a transient index/cache for fast page lookup and lock coordination.
It is reconstructible from WAL, not part of durable DB state.

Key properties:

- multi-byte integers use host native byte order (not cross-platform format)
- except copied WAL salt bytes, which keep WAL byte order
- file is chunked in 32,768-byte units

### Unit layout

First 32,768-byte unit:

```text
u8  aWalIndexHeader[136]
u32 aPgno[4062]
u16 aHash[8192]
```

Subsequent 32,768-byte units:

```text
u32 aPgno[4096]
u16 aHash[8192]
```

### Header layout (136 bytes total)

The first 96 bytes are two copies of `WalIndexHdr` (48 bytes each), then
checkpoint/reader-lock metadata.

| Offset | Size | Field |
|---:|---:|---|
| 0..47 | 48 | WalIndexHdr copy #1 |
| 48..95 | 48 | WalIndexHdr copy #2 |
| 96..99 | 4 | `nBackfill` |
| 100..119 | 20 | `readMark[0..4]` |
| 120..127 | 8 | lock bytes |
| 128..131 | 4 | `nBackfillAttempted` |
| 132..135 | 4 | padding/reserved |

`WalIndexHdr` field offsets (within each 48-byte copy):

| Offset | Size | Field |
|---:|---:|---|
| 0..3 | 4 | `iVersion` (`3007000`) |
| 4..7 | 4 | unused |
| 8..11 | 4 | `iChange` |
| 12 | 1 | `isInit` |
| 13 | 1 | `bigEndCksum` |
| 14..15 | 2 | `szPage` (`1` encodes 65536) |
| 16..19 | 4 | `mxFrame` |
| 20..23 | 4 | `nPage` |
| 24..31 | 8 | `aFrameCksum` |
| 32..39 | 8 | `aSalt` |
| 40..47 | 8 | `aCksum` (checksum of bytes 0..39) |

Notes:

- SQLite double-copies this header and validates equality + checksum to detect
  torn/dirty concurrent reads.
- The lock region begins at offset 120 in the standard implementation.
- `readMark[0..4]` reflects the default 5-reader build configuration.

### Hash lookup

For page `P`, base hash is:

```text
h = (P * 383) % 8192
```

`aHash` open-addresses into `aPgno` indexes. Search proceeds from newest unit to
oldest to find latest frame ≤ reader max frame.

## Exclusive Locking Mode and WASM

In exclusive locking mode:

- SQLite does not require shared-memory APIs (`xShmMap/xShmLock/...`)
- no `-shm` file is required
- wal-index is maintained in heap memory

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
5. Commit boundaries come only from commit frames (`db_size_after_commit != 0`).
6. Rewind/rebase logic must preserve coherent `mxFrame` semantics and either
   rebuild or correctly maintain wal-index mappings.
7. Auto-checkpoint should be disabled during speculative periods where rollback
   of optimistic frames may be needed.
8. Replicate WAL frames, not `-shm`; wal-index is host-endian transient state.

## References

- [SQLite Database File Format (`fileformat.html`)](https://www.sqlite.org/fileformat.html)
- [SQLite WAL-mode File Format (`walformat.html`)](https://www.sqlite.org/walformat.html)
- [SQLite WAL Overview (`wal.html`)](https://www.sqlite.org/wal.html)
- [SQLite source: `src/wal.c` (canonical implementation details)](https://www.sqlite.org/src/doc/tip/src/wal.c)
- [SQLite PRAGMA docs (`wal_autocheckpoint`, `wal_checkpoint`)](https://www.sqlite.org/pragma.html)
- [SQLite C API: `sqlite3_wal_autocheckpoint()`](https://www.sqlite.org/c3ref/wal_autocheckpoint.html)
- [SQLite WASM persistence docs (WAL with OPFS)](https://sqlite.org/wasm/doc/tip/persistence.md)
