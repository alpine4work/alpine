import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {runDatabaseDurableObjectSqlMigrations} from "~/server/databases/database_durable_object_sql_migrations.js";
import {
    type LocalAccessPolicy,
    LocalAccessPolicySchema,
} from "~/shared/access/access_policy.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * {@link DatabaseServerStorage} implementation backed by a Cloudflare Durable
 * Object's {@link SqlStorage}.
 *
 * Pages are partitioned by {@link DatabaseTableId} so one Durable Object can host
 * many SQLite databases. Storage uses two tables:
 *
 * - `database_table_ids(sqlite_id, database_table_id)` — maps each external string
 *   id to a small integer `sqlite_id` (its rowid) used as the partition key in
 *   `pages`. This keeps long ids out of the hot row.
 * - `pages(sqlite_id, page_index, version, data)` — versioned page rows keyed by
 *   `(sqlite_id, page_index, version)`. A `NULL` `data` marks a tombstone (left
 *   behind by truncates) which is surfaced as a missing page at the {@link
 *   DatabaseServerStorage} boundary.
 *
 * The `sqlite_id` is purely an internal storage optimization and never leaks
 * across the {@link DatabaseServerStorage} boundary.
 *
 * Versions are global across tables: a single counter is bumped once per {@link
 * writePages} call, and every row inserted by that call is stamped with the new
 * value.
 */
export class DatabaseDurableObjectStorage implements DatabaseServerStorage {
    private readonly storage: DurableObjectStorage;
    private readonly sql: SqlStorage;
    private readonly sqliteIds = new Map<DatabaseTableId, number>();
    private readonly fileSizes = new Map<DatabaseTableId, number>();
    private lastWriteVersion: number | undefined;

    constructor(storage: DurableObjectStorage) {
        this.storage = storage;
        this.sql = storage.sql;
        runDatabaseDurableObjectSqlMigrations(storage);
    }

    transactionSync<T>(fn: () => T): T {
        return this.storage.transactionSync(fn);
    }

    getDatabaseTableAccessPolicy(tableId: DatabaseTableId): LocalAccessPolicy | null {
        const result = this.sql.exec<{access_policy: string}>(
            "SELECT access_policy FROM database_table_access_policies WHERE database_table_id = ?",
            tableId,
        );
        const row = result.next();
        if (row.done) return null;
        assert(result.next().done);
        return LocalAccessPolicySchema.deserialize(
            JSON.parse(row.value.access_policy) as SchemaSerializedValue,
        );
    }

    setDatabaseTableAccessPolicy(
        tableId: DatabaseTableId,
        accessPolicy: LocalAccessPolicy | null,
    ): void {
        if (accessPolicy === null) {
            this.sql.exec(
                "DELETE FROM database_table_access_policies WHERE database_table_id = ?",
                tableId,
            );
            return;
        }
        this.sql.exec(
            `INSERT INTO database_table_access_policies (database_table_id, access_policy)
             VALUES (?, ?)
             ON CONFLICT (database_table_id) DO UPDATE SET access_policy = excluded.access_policy`,
            tableId,
            JSON.stringify(LocalAccessPolicySchema.serialize(accessPolicy)),
        );
    }

    readPage(
        databaseTableId: DatabaseTableId,
        index: number,
    ): {data: Uint8Array; version: number} | null {
        const sqliteId = this.lookupSqliteId(databaseTableId);
        if (sqliteId === undefined) {
            return null;
        }
        const result = this.sql.exec<{
            data: ArrayBuffer | null;
            version: number;
        }>(
            "SELECT data, version FROM pages WHERE sqlite_id = ? AND page_index = ? ORDER BY version DESC LIMIT 1",
            sqliteId,
            index,
        );
        const row = result.next();
        if (row.done) {
            return null;
        }

        assert(result.next().done);
        // Tombstones (data IS NULL) surface as missing pages — the underlying file size
        // already shrank past them via {@link truncate}, so no caller needs to
        // distinguish.
        if (row.value.data === null) {
            return null;
        }
        return {
            data: new Uint8Array(row.value.data),
            version: row.value.version,
        };
    }

    writePages(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): number {
        const version = this.nextVersion();

        // Truncates first: tombstone every page at or past each table's new boundary. A
        // subsequent write to a page in this batch that falls past the boundary re-extends
        // the file naturally — the boundary write just becomes the latest row at the same
        // version.
        for (const [databaseTableId, size] of truncates) {
            const sqliteId = this.getOrCreateSqliteId(databaseTableId);
            const maxPageIndex = Math.floor(size / sqlitePageSize);
            for (const {page_index} of this.sql.exec<{page_index: number}>(
                "SELECT DISTINCT page_index FROM pages WHERE sqlite_id = ? AND page_index >= ?",
                sqliteId,
                maxPageIndex,
            )) {
                this.sql.exec(
                    "INSERT INTO pages (sqlite_id, page_index, version, data) VALUES (?, ?, ?, NULL)",
                    sqliteId,
                    page_index,
                    version,
                );
            }
            this.fileSizes.set(databaseTableId, size);
        }

        for (const [databaseTableId, tablePages] of pages) {
            const sqliteId = this.getOrCreateSqliteId(databaseTableId);
            for (const [index, data] of tablePages) {
                this.sql.exec(
                    "INSERT INTO pages (sqlite_id, page_index, version, data) VALUES (?, ?, ?, ?)",
                    sqliteId,
                    index,
                    version,
                    data.buffer,
                );
                const end = (index + 1) * sqlitePageSize;
                if (end > this.getFileSize(databaseTableId)) {
                    this.fileSizes.set(databaseTableId, end);
                }
            }
        }

        return version;
    }

    getFileSize(databaseTableId: DatabaseTableId): number {
        const cached = this.fileSizes.get(databaseTableId);
        if (cached !== undefined) {
            return cached;
        }
        const sqliteId = this.lookupSqliteId(databaseTableId);
        if (sqliteId === undefined) {
            this.fileSizes.set(databaseTableId, 0);
            return 0;
        }
        const result = this.sql.exec<{page_index: number}>(
            `SELECT p.page_index FROM pages p
             WHERE p.sqlite_id = ?
               AND p.version = (
                   SELECT MAX(p2.version) FROM pages p2
                   WHERE p2.sqlite_id = ? AND p2.page_index = p.page_index
               )
               AND p.data IS NOT NULL
             ORDER BY p.page_index DESC
             LIMIT 1`,
            sqliteId,
            sqliteId,
        );
        const row = result.next();
        if (row.done) {
            this.fileSizes.set(databaseTableId, 0);
            return 0;
        }
        assert(result.next().done);
        const size = (row.value.page_index + 1) * sqlitePageSize;
        this.fileSizes.set(databaseTableId, size);
        return size;
    }

    private nextVersion(): number {
        if (this.lastWriteVersion === undefined) {
            // Cold load: recover MAX(version) across every table so the next stamp is strictly
            // greater than anything already persisted.
            const result = this.sql.exec<{v: number | null}>("SELECT MAX(version) AS v FROM pages");
            const row = result.next();
            this.lastWriteVersion = row.done || row.value.v === null ? 0 : row.value.v;
        }
        this.lastWriteVersion++;
        return this.lastWriteVersion;
    }

    /**
     * Resolve `databaseTableId` to its internal `sqlite_id`, returning `undefined` if
     * no row exists yet. Used by read paths so an unwritten table doesn't silently
     * register a `sqlite_id`.
     */
    private lookupSqliteId(databaseTableId: DatabaseTableId): number | undefined {
        const cached = this.sqliteIds.get(databaseTableId);
        if (cached !== undefined) {
            return cached;
        }
        const result = this.sql.exec<{sqlite_id: number}>(
            "SELECT sqlite_id FROM database_table_ids WHERE database_table_id = ?",
            databaseTableId,
        );
        const row = result.next();
        if (row.done) {
            return undefined;
        }
        assert(result.next().done);
        this.sqliteIds.set(databaseTableId, row.value.sqlite_id);
        return row.value.sqlite_id;
    }

    /**
     * Resolve `databaseTableId` to its internal `sqlite_id`, inserting a fresh row in
     * `database_table_ids` on first write.
     */
    private getOrCreateSqliteId(databaseTableId: DatabaseTableId): number {
        const existing = this.lookupSqliteId(databaseTableId);
        if (existing !== undefined) {
            return existing;
        }
        const result = this.sql.exec<{sqlite_id: number}>(
            "INSERT INTO database_table_ids (database_table_id) VALUES (?) RETURNING sqlite_id",
            databaseTableId,
        );
        const row = result.next();
        assert(!row.done);
        assert(result.next().done);
        this.sqliteIds.set(databaseTableId, row.value.sqlite_id);
        return row.value.sqlite_id;
    }
}
