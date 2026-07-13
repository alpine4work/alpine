import type {
    DatabaseServerStorage,
    DatabaseServerTableAccessEntry,
} from "~/server/databases/database_server_storage.js";
import {type LocalAccessPolicy, LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import type {DatabaseServerTableRegistration} from "~/shared/databases/database_action_context.js";
import {sql} from "~/shared/databases/sql.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * {@link DatabaseServerStorage} implementation backed by a Cloudflare Durable
 * Object's {@link SqlStorage}.
 *
 * Pages are partitioned by {@link DatabaseTableId} so one Durable Object can host
 * many SQLite databases. Storage uses two data tables:
 *
 * - `database_tables(sqlite_id, table_id, kind, table_name, schema_version, access_policy, source_table_id, target_table_id)`
 *   maps each external string id to a small integer and stores the table's
 *   registration — see the migration in
 *   `database_durable_object_sql_migrations.ts` for the column semantics.
 * - `database_table_pages(sqlite_id, page_index, version, data)` stores versioned
 *   pages keyed by `(sqlite_id, page_index, version)`. A `NULL` `data` marks a
 *   tombstone (left behind by truncates) which is surfaced as a missing page at
 *   the {@link DatabaseServerStorage} boundary.
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
    }

    transactionSync<T>(fn: () => T): T {
        return this.storage.transactionSync(fn);
    }

    registerDatabaseTable(
        tableId: DatabaseTableId,
        registration: DatabaseServerTableRegistration & {schemaVersion: number},
    ): void {
        sql`
            INSERT INTO
                database_tables (
                    table_id,
                    kind,
                    table_name,
                    schema_version,
                    access_policy,
                    source_table_id,
                    target_table_id
                )
            VALUES
                (
                    ${tableId},
                    ${registration.kind},
                    ${registration.tableName},
                    ${registration.schemaVersion},
                    ${registration.kind === "table"
                ? serializeAccessPolicy(registration.accessPolicy)
                : null},
                    ${registration.kind === "join" ? registration.sourceTableId : null},
                    ${registration.kind === "join" ? registration.targetTableId : null}
                )
            ON CONFLICT (table_id) DO UPDATE
            SET
                kind = excluded.kind,
                table_name = excluded.table_name,
                schema_version = excluded.schema_version,
                access_policy = excluded.access_policy,
                source_table_id = excluded.source_table_id,
                target_table_id = excluded.target_table_id
        `.exec(this.sql);
    }

    getDatabaseTableAccessEntry(tableId: DatabaseTableId): DatabaseServerTableAccessEntry | null {
        // `kind IS NOT NULL` drops unregistered rows (created by a bare page write or an
        // early policy push) — they resolve to no entry, fail closed, same as a missing
        // row.
        const row = sql`
            SELECT
                kind,
                access_policy,
                source_table_id,
                target_table_id
            FROM
                database_tables
            WHERE
                table_id = ${tableId}
                AND kind IS NOT NULL
        `.selectOneOrNone(this.sql, databaseTableRowSchema);
        if (row === null) return null;
        switch (row.kind) {
            case "table":
                return {kind: "table", accessPolicy: deserializeAccessPolicy(row.accessPolicy)};
            case "join":
                return row;
            default:
                throw exhaustive(row);
        }
    }

    listDatabaseTables(): Array<{
        tableId: DatabaseTableId;
        kind: "table" | "join";
        schemaVersion: number;
    }> {
        return sql`
            SELECT
                table_id,
                kind,
                schema_version
            FROM
                database_tables
            WHERE
                kind IS NOT NULL
            ORDER BY
                table_id
        `.selectAll(this.sql, {
            tableId: Schema.id<DatabaseTableId>().originalPropertyKey("table_id"),
            kind: Schema.enum(["table", "join"]),
            schemaVersion: Schema.integer.originalPropertyKey("schema_version"),
        });
    }

    getDatabaseTableAccessPolicy(tableId: DatabaseTableId): LocalAccessPolicy | null {
        const accessPolicy = sql`
            SELECT
                access_policy
            FROM
                database_tables
            WHERE
                table_id = ${tableId}
        `.selectValueIfExists(this.sql, Schema.string.nullable());
        return deserializeAccessPolicy(accessPolicy ?? null);
    }

    setDatabaseTableAccessPolicy(
        tableId: DatabaseTableId,
        accessPolicy: LocalAccessPolicy | null,
    ): void {
        sql`
            INSERT INTO
                database_tables (table_id, access_policy)
            VALUES
                (
                    ${tableId},
                    ${serializeAccessPolicy(accessPolicy)}
                )
            ON CONFLICT (table_id) DO UPDATE
            SET
                access_policy = excluded.access_policy
        `.exec(this.sql);
    }

    setDatabaseTableName(tableId: DatabaseTableId, tableName: string): void {
        const updated = sql`
            UPDATE database_tables
            SET
                table_name = ${tableName}
            WHERE
                table_id = ${tableId}
            RETURNING
                1
        `.selectValueIfExists(this.sql, Schema.integer);
        assert(updated !== null, `setDatabaseTableName: unknown table ${tableId}`);
    }

    isDatabaseTableNameTaken(tableName: string, excludeTableId?: DatabaseTableId): boolean {
        const excludeClause =
            excludeTableId === undefined ? sql`` : sql` AND table_id != ${excludeTableId} `;
        return (
            sql`
                SELECT
                    1
                FROM
                    database_tables
                WHERE
                    table_name = ${tableName} ${excludeClause}
            `.selectValueIfExists(this.sql, Schema.integer) !== null
        );
    }

    setDatabaseTableSchemaVersion(tableId: DatabaseTableId, schemaVersion: number): void {
        sql`
            UPDATE database_tables
            SET
                schema_version = ${schemaVersion}
            WHERE
                table_id = ${tableId}
        `.exec(this.sql);
    }

    readPage(
        databaseTableId: DatabaseTableId,
        index: number,
    ): {data: Uint8Array; version: number} | null {
        const sqliteId = this.lookupSqliteId(databaseTableId);
        if (sqliteId === undefined) {
            return null;
        }
        const row = sql`
            SELECT
                data,
                version
            FROM
                database_table_pages
            WHERE
                sqlite_id = ${sqliteId}
                AND page_index = ${index}
            ORDER BY
                version DESC
            LIMIT
                1
        `.selectOneOrNone(this.sql, {
            data: Schema.bytes.nullable(),
            version: Schema.integer,
        });
        // Tombstones (data IS NULL) surface as missing pages — the underlying file size
        // already shrank past them via truncation, so no caller needs to distinguish.
        if (row === null || row.data === null) {
            return null;
        }
        return {data: row.data, version: row.version};
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
            const pageIndexes = sql`
                SELECT DISTINCT
                    page_index
                FROM
                    database_table_pages
                WHERE
                    sqlite_id = ${sqliteId}
                    AND page_index >= ${maxPageIndex}
            `.selectValues(this.sql, Schema.integer);
            for (const pageIndex of pageIndexes) {
                sql`
                    INSERT INTO
                        database_table_pages (sqlite_id, page_index, version, data)
                    VALUES
                        (
                            ${sqliteId},
                            ${pageIndex},
                            ${version},
                            NULL
                        )
                `.exec(this.sql);
            }
            this.fileSizes.set(databaseTableId, size);
        }

        for (const [databaseTableId, tablePages] of pages) {
            const sqliteId = this.getOrCreateSqliteId(databaseTableId);
            for (const [index, data] of tablePages) {
                sql`
                    INSERT INTO
                        database_table_pages (sqlite_id, page_index, version, data)
                    VALUES
                        (
                            ${sqliteId},
                            ${index},
                            ${version},
                            ${data}
                        )
                `.exec(this.sql);
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
        const lastPageIndex = sql`
            SELECT
                p.page_index
            FROM
                database_table_pages p
            WHERE
                p.sqlite_id = ${sqliteId}
                AND p.version = (
                    SELECT
                        MAX(p2.version)
                    FROM
                        database_table_pages p2
                    WHERE
                        p2.sqlite_id = ${sqliteId}
                        AND p2.page_index = p.page_index
                )
                AND p.data IS NOT NULL
            ORDER BY
                p.page_index DESC
            LIMIT
                1
        `.selectValueIfExists(this.sql, Schema.integer);
        const size = lastPageIndex === null ? 0 : (lastPageIndex + 1) * sqlitePageSize;
        this.fileSizes.set(databaseTableId, size);
        return size;
    }

    private nextVersion(): number {
        if (this.lastWriteVersion === undefined) {
            // Cold load: recover MAX(version) across every table so the next stamp is strictly
            // greater than anything already persisted.
            this.lastWriteVersion =
                sql`
                    SELECT
                        MAX(version)
                    FROM
                        database_table_pages
                `.selectValue(this.sql, Schema.integer.nullable()) ?? 0;
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
        const sqliteId = sql`
            SELECT
                sqlite_id
            FROM
                database_tables
            WHERE
                table_id = ${databaseTableId}
        `.selectValueIfExists(this.sql, Schema.integer);
        if (sqliteId === null) {
            return undefined;
        }
        this.sqliteIds.set(databaseTableId, sqliteId);
        return sqliteId;
    }

    /**
     * Resolve `databaseTableId` to its internal `sqlite_id`, inserting a fresh row in
     * `database_tables` on first write.
     */
    private getOrCreateSqliteId(databaseTableId: DatabaseTableId): number {
        const existing = this.lookupSqliteId(databaseTableId);
        if (existing !== undefined) {
            return existing;
        }
        const sqliteId = sql`
            INSERT INTO
                database_tables (table_id)
            VALUES
                (${databaseTableId})
            RETURNING
                sqlite_id
        `.selectValue(this.sql, Schema.integer);
        this.sqliteIds.set(databaseTableId, sqliteId);
        return sqliteId;
    }
}

/**
 * Row shape for {@link DatabaseDurableObjectStorage.getDatabaseTableAccessEntry},
 * discriminated on the registration `kind` (the CHECK constraint in
 * `database_durable_object_sql_migrations.ts` guarantees each variant's columns).
 */
const databaseTableRowSchema = Schema.unionWithKey("kind", {
    table: Schema.object({
        kind: Schema.value("table"),
        accessPolicy: Schema.string.nullable().originalPropertyKey("access_policy"),
    }),
    join: Schema.object({
        kind: Schema.value("join"),
        sourceTableId: Schema.id<DatabaseTableId>().originalPropertyKey("source_table_id"),
        targetTableId: Schema.id<DatabaseTableId>().originalPropertyKey("target_table_id"),
    }),
});

function serializeAccessPolicy(accessPolicy: LocalAccessPolicy | null): string | null {
    if (accessPolicy === null) return null;
    return JSON.stringify(LocalAccessPolicySchema.serialize(accessPolicy));
}

function deserializeAccessPolicy(accessPolicy: string | null): LocalAccessPolicy | null {
    if (accessPolicy === null) return null;
    return LocalAccessPolicySchema.deserialize(JSON.parse(accessPolicy) as SchemaSerializedValue);
}
