# Alpine Databases: Technical Vision (v0)

## Purpose

Alpine Databases is a new realtime product for collaborative structured data (similar category to
Airtable, Smartsheet, and Notion databases) backed by SQLite.

This document defines the initial technical architecture and expected difficulties. It is
intentionally focused on data model, replication, and correctness, not UI decisions.

## Product Direction

We want a system with:

- SQL as the core programming model.
- Local-first reads and writes for fast interaction.
- Realtime multi-account collaboration in shared spaces.
- Strong server authority for correctness, permissions, and ordering.

The high-level model is:

- A server-side SQLite database is canonical.
- Connected clients run a local SQLite database in WASM.
- Server commits are streamed to clients.
- Clients apply optimistic local writes, then reconcile with server ordering.

## Core Architecture (Current Proposal)

## 1) Canonical Server

- Server runs SQLite with WAL enabled.
- All writes are serialized by the server.
- Every committed transaction is assigned a monotonic `commitSequence`.
- Server exposes:
    - Snapshot endpoint (bootstrap a client from a consistent point).
    - Realtime commit stream from a sequence onward.
    - Write endpoint for client transaction intents.

## 2) Local Client Database

- Browser/client keeps a local SQLite database (WASM runtime).
- Reads execute locally.
- Writes execute locally first (optimistic) and are queued for server commit.
- Client tracks:
    - `appliedServerSequence`: latest remote commit applied locally.
    - Pending optimistic writes (in local order).

## 3) Write/Reconcile Flow

For a local write intent:

1. Execute SQL locally in a transaction and capture reversible state.
2. Send the write intent to server with base `commitSequence`.
3. If server accepts:
    - Server commits transaction, emits new sequence.
    - Client marks pending write as confirmed.
4. If server rejects:
    - Client reverts the optimistic local transaction.
5. If remote commits arrive before local write is confirmed:
    - Revert pending optimistic write(s).
    - Apply remote server commit(s) in sequence order.
    - Re-run pending local write(s) against new head.

This gives deterministic server ordering while preserving local responsiveness.

## WAL + WASM Reality Check

Official SQLite WASM documentation now describes a WAL path for OPFS VFS, but with an important
constraint: WAL mode requires `PRAGMA locking_mode=exclusive` set immediately after opening the
database (before other interactions).

Implications for Alpine:

- WAL can likely be used for our single-runtime optimistic rollback/rebase flow.
- We should not expect normal WAL multi-reader/multi-connection concurrency semantics in browser
  clients from that mode.
- We may still need a custom build/VFS later if product requirements need richer cross-context
  coordination than exclusive mode allows.

This must be validated by prototype work before we commit to replication format.

## Core Technology Choices

- SQLite everywhere:
    - Server: canonical execution engine and commit ordering.
    - Client: same SQL semantics via WASM for low-latency local execution.
- Realtime commit stream with explicit sequence numbers.
- Optimistic local writes with rollback + rebase.
- Start from official SQLite WASM + OPFS behavior to prove feasibility quickly.
- Introduce custom SQLite WASM/VFS only if exclusive-mode constraints block product requirements.

## Difficulties We Expect

## 1) WAL Support in Browser WASM

- WAL mode is available in OPFS with exclusive locking constraints.
- `locking_mode=exclusive` must be set early and may constrain connection lifecycle and multi-tab
  behavior.
- We need strict invariants around per-database runtime ownership.
- A custom build and VFS may still be required for advanced coordination.
- Multi-tab behavior may require a SharedWorker/leader model or explicit single-writer constraints
  per account+database in browser context.

## 2) Replication Granularity

Streaming raw WAL frames is attractive but fragile:

- Page-level replication tightly couples page size, file state, and pragmas.
- Divergence handling is harder than logical transaction replication.

We may need WAL as an internal mechanism while streaming a higher-level commit format (for example,
SQL intents plus deterministic metadata, or SQLite changesets).

## 3) Deterministic Rebase of Local Writes

Re-running writes after remote commits only works if writes are deterministic. Risks:

- Non-deterministic SQL (`random()`, time functions, unordered updates).
- Implicit rowid/autoincrement assumptions.
- Side effects in application logic outside SQL transaction boundaries.

We likely need a constrained write API and explicit guidance for deterministic mutations.

## 4) Permission and Validation Semantics

- Server is authoritative for ACLs and invariants.
- Client optimistic success can still fail at server commit time.
- Error reporting must be precise so UI can explain reverted local changes.

## 5) Schema Evolution

- Migrations must preserve replication compatibility.
- Clients on old code may receive commits against newer schema.
- Snapshot + sequence protocol needs explicit migration/version metadata.

## 6) Recovery, Durability, and Backfill

- Interrupted clients need fast catch-up from persisted local state.
- Large histories need compaction/checkpoint/snapshot strategy.
- We need clear behavior for local corruption or irreconcilable divergence (automatic re-snapshot).

## Initial Milestones

## Milestone 1: Feasibility Spike (WAL in WASM)

- Start with official SQLite WASM + OPFS in exclusive locking mode.
- Only move to custom SQLite build/VFS if the official path cannot satisfy core invariants.
- Prove:
    - Local transaction apply.
    - Revert of local optimistic transaction.
    - Re-apply after external commit simulation.

Exit criteria: we can demonstrate rollback/rebase loop in a single client runtime.

## Milestone 2: Server Commit Sequencer

- Define write intent protocol and commit sequence contract.
- Add server commit log and realtime stream endpoint.
- Support snapshot + catch-up from sequence.

Exit criteria: multiple clients converge under concurrent writes.

## Milestone 3: Deterministic Write API

- Constrain allowed write shapes and disallow unsafe non-determinism where needed.
- Add validation and clear error contracts for rejected optimistic writes.

Exit criteria: reliable replay/rebase in realistic product operations.

## Open Questions

- Should network replication payloads be raw WAL frames, SQL intents, or SQLite changesets?
- What is the exact rollback primitive on client:
    - WAL frame rewind, savepoint inversion, or changeset inversion?
- What multi-tab policy do we want initially:
    - Single-tab writer lock or full multi-tab coordination?
- Which SQLite features do we explicitly support in v1 (triggers, FTS, virtual tables, custom
  functions)?
- What are performance targets for large tables and long offline windows?

## Non-Goals (for this phase)

- Final end-user UI/interaction design.
- Full offline conflict resolution semantics across independent canonical authorities (we have one
  canonical server authority).
- Arbitrary plugin/extension execution inside SQLite on clients.

## References

- [SQLite WASM docs: OPFS and WAL notes](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [SQLite WASM API docs](https://sqlite.org/wasm/doc/trunk/api-index.md)
