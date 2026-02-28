# SQLSync vs Alpine Databases: Architecture Comparison

_Assessed: February 2026. SQLSync repo: [orbitinghail/sqlsync](https://github.com/orbitinghail/sqlsync)._

---

## Executive Summary

SQLSync and the Alpine Databases architecture share a high-level problem statement—collaborative,
eventually-consistent SQLite with optimistic concurrency—but diverge at the most fundamental level:
**the synchronization primitive**. Alpine syncs raw SQLite WAL frames (page-level storage diffs);
SQLSync syncs application-level mutation commands (serialized Rust structs run through a Wasm
reducer). This single difference cascades into nearly every design decision below. SQLSync cannot be
used as a drop-in implementation.

---

## What SQLSync Is

SQLSync is a Rust library (with TypeScript/JavaScript bindings) for collaborative offline-first
SQLite. Its architecture:

- **Reducer model.** All writes go through a user-supplied WebAssembly module written in Rust. The
  reducer defines a set of named mutation types; callers invoke mutations by name with serialized
  arguments. Arbitrary SQL writes are not permitted—only pre-declared mutation types.
- **Custom VFS, no WAL.** SQLSync implements a Rust VFS (`sqlite-vfs`) that intercepts page reads
  and writes. WAL mode is explicitly **not used**: `xShmMap` and `xShmLock` are stubbed to return
  errors. Instead, SQLSync maintains its own page journal abstraction (`Storage<J>`) with LSN
  (Log Sequence Number) ranges.
- **Page journal.** The storage layer tracks "pending" pages (uncommitted, local) and "committed"
  pages (from the coordinator journal), stored as sparse page snapshots indexed by LSN.
- **Timeline = mutation log.** The local timeline is a sequence of raw mutation bytes. Rebasing
  means replaying this log through the reducer against a fresh committed base, not manipulating WAL
  frames.
- **Coordinator (server).** Receives mutations, applies them through the reducer, records resulting
  page diffs into a coordinator journal (LSN-indexed), and replicates to clients.
- **Replication protocol.** LSN-range-based: client sends its current LSN range; coordinator streams
  delta frames with flow control (max 100 outstanding frames). Functionally equivalent to Alpine's
  delta sync / snapshot split but implemented at the mutation level.
- **Offline-first.** A primary design goal, with full local operation and convergence on
  reconnection.
- **Language.** Rust core, compiled to Wasm. JavaScript bindings for the browser. React and
  Solid.js integrations.

---

## Side-by-Side Comparison

| Dimension | Alpine Databases | SQLSync |
|---|---|---|
| **Sync primitive** | Raw SQLite WAL frames (page-level) | Application-level mutation commands |
| **WAL mode** | Core requirement; exclusive locking mode in Wasm | Not used; `xShmMap`/`xShmLock` return errors |
| **Custom VFS** | Needed for frame interception + OPFS | Already exists (Rust `sqlite-vfs`) |
| **Write API** | Arbitrary SQL sent to server | Pre-declared mutation types in Rust Wasm reducer |
| **Determinism requirement** | Not required; server frames always win | Required; reducer must produce identical results on all nodes |
| **Optimistic writes** | Execute SQL locally → WAL frames as optimistic state | Reducer runs locally → pending pages as optimistic state |
| **Rebase on conflict** | Revert WAL frames + re-execute SQL command | Replay mutation log through reducer against committed base |
| **Server always wins** | Yes, via WAL frame replacement | Yes, via committed page journal replacing pending |
| **Schema awareness in sync layer** | None; WAL frames are raw pages | None at storage level; mutations are schema-aware |
| **Delta sync** | WAL frame ranges by frame number | LSN ranges with flow-controlled streaming |
| **Full snapshot fallback** | Yes, when client is outside retention window | Implied (client resets to remote range on timeline truncation) |
| **Offline support** | Non-goal | Primary design goal |
| **Cross-tab sharing** | Shared web worker | Shared web worker |
| **Language** | TypeScript throughout | Rust core; TypeScript bindings |
| **Persistence** | OPFS | Custom VFS (in-memory `MemoryJournal` in tests; OPFS-backed in practice) |
| **Maturity** | Design/build phase | Beta; not production-ready |

---

## Where They Agree

1. **Optimistic concurrency with rebase.** Both apply writes locally first, send to a canonical
   server, and handle the case where intervening server commits require rebasing the local pending
   state. The pattern is structurally the same; the mechanism differs.

2. **Single shared web worker.** Both route all database access through one worker per document to
   serialize operations and share state across browser tabs.

3. **Server as source of truth.** Both models designate a central coordinator as authoritative.
   Client state converges toward the server's committed log.

4. **LSN/frame sequence numbers.** Both use monotonically increasing sequence numbers to track
   position in the log and to drive delta vs. snapshot sync decisions.

5. **No concurrent reads/writes within SQLite.** Both serialize SQLite access by design.

6. **Page-level journaling concept.** SQLSync's `Storage<J>` (sparse pages per LSN) is conceptually
   what Alpine's WAL frame journal needs to be, just at a higher abstraction level.

---

## Where They Diverge (The Fatal Differences)

### 1. Sync primitive: mutations vs. WAL frames

This is the root incompatibility. Alpine's architecture is explicitly built on WAL frames as the
replication unit—schema-agnostic, complete, compact, ordered. SQLSync never touches WAL frames; its
replication unit is the mutation command.

Consequence: SQLSync has no mechanism to inject, extract, or revert WAL frames. Its VFS
intentionally errors on WAL shared-memory calls. The entire frame manipulation infrastructure
Alpine needs (inject server frames, revert optimistic frames, control checkpointing) simply does
not exist in SQLSync and would have to be built from scratch anyway.

### 2. Reducer vs. arbitrary SQL

SQLSync's mutation model requires all writes to be expressed as pre-compiled Rust mutation types in
a Wasm module. Alpine wants to support arbitrary SQL commands (any `INSERT`, `UPDATE`, `DELETE`,
etc.) from TypeScript.

Adopting SQLSync's model would mean:
- Every mutation type must be defined and compiled in Rust ahead of time.
- No ad-hoc SQL from the client.
- A Rust build pipeline as a dependency.
- A completely different DX from what Alpine's database product appears to target.

### 3. Determinism

SQLSync requires reducers to be deterministic—the same mutation applied to the same base state must
produce the same pages everywhere. This is how eventual consistency is achieved without a "server
always wins" override.

Alpine's architecture explicitly acknowledges non-determinism (`random()`, `now()`, trigger side
effects) and handles it by always replacing local results with server frames. These are mutually
incompatible consistency models. Alpine's model is simpler for the application developer; SQLSync's
model requires discipline in reducer design.

### 4. Language

SQLSync's core is Rust. Alpine is TypeScript throughout (including server-side with Cloudflare
Workers and Node.js). Integrating SQLSync would require:
- Rust toolchain in the build system (Bazel integration).
- Wasm boundary for all core logic.
- A Rust-fluent team member for any core changes.

### 5. No WAL frame control

Even if the language gap were bridged, SQLSync provides no path to the frame-level hooks Alpine
needs: reading WAL frames after a local write, injecting server frames into the live database,
reverting frames, and controlling checkpointing. These are zero-surfaced in SQLSync's API.

---

## Drop-In Assessment

**SQLSync cannot be used as a drop-in implementation.** The incompatibilities are architectural, not
cosmetic:

| Requirement | SQLSync provides? |
|---|---|
| WAL frame extraction after local write | No |
| WAL frame injection from server | No |
| WAL frame revert (optimistic rollback) | No |
| Arbitrary SQL mutation model | No |
| Checkpoint control | No |
| TypeScript implementation | No (Rust core) |
| Non-deterministic SQL handling | No |

The only things Alpine could lift from SQLSync without modification are:
- The **shared web worker** pattern (but Alpine already specifies this).
- The **replication protocol design** (LSN ranges, delta/snapshot split, flow control) as a
  reference for Alpine's own wire protocol.
- The **rebase pattern** as validation that the approach is sound.

---

## What SQLSync Validates

SQLSync does confirm that the core optimistic-concurrency-with-rebase architecture is buildable and
has been demonstrated to work. Specifically:

- The "apply locally, send to server, rebase on conflict" loop is production-approachable.
- Shared web worker + single serialized SQLite connection is viable for collaborative apps.
- LSN-based delta sync with a snapshot fallback is the right protocol shape.
- The rebase operation (replaying pending mutations on top of a new committed base) handles
  concurrent server commits correctly.

These are meaningful signal that Alpine's architecture is directionally correct, even though the
implementation must be built independently.

---

## Alternative Framing

One way to read the relationship: SQLSync is solving an easier version of the same problem by
restricting the mutation model. By requiring a Rust reducer with deterministic, pre-declared
mutation types, SQLSync sidesteps the hardest parts of Alpine's problem:

- No WAL frame manipulation needed (mutations are the log, not pages).
- No non-determinism (reducer is pure).
- No frame checksum chain management.
- No WAL revert semantics (just drop pending pages and replay mutations).

Alpine's bet is that **arbitrary SQL + WAL-frame sync** is worth the additional complexity because
it gives application developers a richer, more natural programming model and makes the sync layer
genuinely schema-agnostic. That bet is probably correct for a productivity suite, but it means
SQLSync's implementation offers little reuse.
