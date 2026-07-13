import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import type {ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import type {DatabaseServerTableRegistration} from "~/shared/databases/database_action_context.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * A registered table's access metadata, read synchronously by the SQLite
 * authorizer's per-statement lookup. `null` policies (a table whose policy copy
 * hasn't arrived) evaluate to no access — fail closed.
 */
export type DatabaseServerTableAccessEntry =
    | {kind: "table"; accessPolicy: LocalAccessPolicy | null}
    | {kind: "join"; sourceTableId: DatabaseTableId; targetTableId: DatabaseTableId};

/**
 * Storage backend for {@link DatabaseServer}. Decouples SQLite's file I/O from the
 * actual persistence mechanism.
 *
 * Read methods come from {@link ReadonlyDatabaseStorage} and are called
 * synchronously by the SQLite VFS during `xRead`/`xFileSize`. The write side is
 * server-only — the server drains its in-memory buffer through {@link writePages}
 * after each successful execute.
 *
 * Pages are partitioned by {@link DatabaseTableId} so a single backend can host
 * many independent SQLite databases. Alongside the pages, the backend keeps one
 * metadata row per table — kind, plaintext SQLite `table_name`, applied migration
 * version, and access metadata (policy copy or join topology). This store never
 * replicates to clients, which is what allows plaintext names and policies in it.
 */
export interface DatabaseServerStorage extends ReadonlyDatabaseStorage {
    transactionSync<T>(fn: () => T): T;

    /**
     * Record a newly created table's registration. Upserts: the row may already exist
     * from an earlier page write or policy push.
     */
    registerDatabaseTable(
        tableId: DatabaseTableId,
        registration: DatabaseServerTableRegistration & {schemaVersion: number},
    ): void;

    /**
     * A registered table's access metadata, or `null` when the id is unknown or not
     * yet registered (callers fail closed).
     */
    getDatabaseTableAccessEntry(tableId: DatabaseTableId): DatabaseServerTableAccessEntry | null;

    /**
     * Every registered table, for access-map building and the bootstrap migration
     * sweep.
     */
    listDatabaseTables(): Array<{
        tableId: DatabaseTableId;
        kind: "table" | "join";
        schemaVersion: number;
    }>;

    setDatabaseTableAccessPolicy(
        tableId: DatabaseTableId,
        accessPolicy: LocalAccessPolicy | null,
    ): void;

    /** Record a rename's resolved SQLite `table_name`. */
    setDatabaseTableName(tableId: DatabaseTableId, tableName: string): void;

    /**
     * Whether any table's `table_name` equals `tableName`, optionally excluding one
     * id.
     */
    isDatabaseTableNameTaken(tableName: string, excludeTableId?: DatabaseTableId): boolean;

    /**
     * Update the mirrored migration version after the bootstrap sweep migrates a file.
     */
    setDatabaseTableSchemaVersion(tableId: DatabaseTableId, schemaVersion: number): void;

    /**
     * Apply a batch of buffered writes atomically.
     *
     * - `pages` — page after-images keyed by table, then by zero-based page index.
     * - `truncates` — post-truncate file sizes in bytes, keyed by table. Every page at
     *   or past the boundary becomes a tombstone (or is otherwise removed) at the same
     *   version stamped on the batch's writes.
     *
     * Truncates are applied before page writes so a write past a truncate boundary
     * correctly re-extends the file. Returns the monotonically increasing version
     * stamped on every row touched in this batch.
     */
    writePages(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): number;
}
