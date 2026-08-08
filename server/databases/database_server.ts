import type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {runDatabaseDurableObjectSqlMigrations} from "~/server/databases/database_durable_object_sql_migrations.js";
import {isInternalDatabaseServiceActor} from "~/server/databases/is_internal_database_service_actor.js";
import {
    type AccessLevel,
    type LocalAccessPolicy,
    LocalAccessPolicySchema,
    getAccountAccessLevelAssumingSpaceAccess,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {allowAllTableAccess} from "~/shared/databases/allow_all_table_access.js";
import {Database} from "~/shared/databases/database.js";
import type {DatabaseServerTableRegistration} from "~/shared/databases/database_action_context.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import type {DatabaseTableAccessPolicyRevision} from "~/shared/databases/database_table_access_policy_revision.js";
import {executeSqliteTransaction} from "~/shared/databases/execute_sqlite_transaction.js";
import {SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {type SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {
    joinTableSqliteMigrations,
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {AccountId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export interface DatabaseServerPageChange {
    before: Uint8Array;
    after: Uint8Array;
    /**
     * Version of the stored page the change was computed against; 0 when the page
     * didn't exist before this batch. Carried into realtime diffs as `previousVersion`
     * so clients can verify their base before applying.
     */
    beforeVersion: number;
}

/**
 * Per-table changed-page report. `pages` carries the before/after images for each
 * page touched in the batch; `fileSizeInPages` is the post-drain canonical SQLite
 * file size for this table — sent alongside the diffs so clients can extend or
 * truncate their cache atomically with the page writes.
 */
export interface DatabaseServerTableChangedPages {
    pages: Map<number, DatabaseServerPageChange>;
    fileSizeInPages: number;
}

export type DatabaseServerReadPages = Map<
    DatabaseTableId,
    Map<number, {data: Uint8Array; version: number}>
>;

export type DatabaseServerChangedPages = Map<DatabaseTableId, DatabaseServerTableChangedPages>;

/**
 * The page + version envelope shared by every execute/executeAction call: what the
 * run read, what it changed, and the global-version marker. {@link
 * DatabaseServerResult} and {@link DatabaseServerActionResult} add the payload
 * (`rows` vs a typed action `result`) on top.
 */
export interface DatabaseServerResultBase {
    /**
     * Full page data + version for every page the run read, partitioned by table. The
     * client fallback path uses this to populate its local cache (and register
     * newly-fetched tables).
     */
    readPages: DatabaseServerReadPages;
    /**
     * Before/after images for every page the run wrote, partitioned by table, plus
     * each table's post-drain `fileSizeInPages`. Consumed by the realtime layer to
     * broadcast `PagesChanged` diffs. Empty when the run wrote nothing — the sole
     * signal for "did this run write" (a run that wrote also advanced {@link
     * snapshotVersion} and stamped its pages at that value).
     */
    changedPages: DatabaseServerChangedPages;
    /**
     * Current global version after the run, whether or not it wrote — the version the
     * data it just read reflects and, for a run that did write, the version stamped on
     * its pages. Clients use it as the read-snapshot watermark; check {@link
     * changedPages} to tell whether this run advanced it.
     */
    snapshotVersion: number;
}

export interface DatabaseServerResult extends DatabaseServerResultBase {
    rows: Array<Record<string, unknown>>;
}

export interface DatabaseServerActionResult<
    N extends DatabaseActionName,
> extends DatabaseServerResultBase {
    result: DatabaseActionOutput<N>;
}

/**
 * A registered table's access metadata, read synchronously by the SQLite
 * authorizer's per-statement lookup. `null` policies (a table whose policy copy
 * hasn't arrived) evaluate to no access — fail closed.
 */
export type DatabaseServerTableAccessEntry =
    | {kind: "table"; accessPolicy: LocalAccessPolicy | null}
    | {kind: "join"; sourceTableId: DatabaseTableId; targetTableId: DatabaseTableId};

/**
 * Canonical SQLite database backed by a Cloudflare Durable Object's {@link
 * SqlStorage}.
 *
 * Wraps a {@link Database}: SQL execution, page tracking, authorization, and the
 * in-memory write buffer all live there. The server's job is to glue that buffer
 * to durable storage — every {@link execute}/{@link executeAction} call captures
 * pre-mutation page snapshots, drains the buffer to the durable object's SQLite,
 * and surfaces `readPages` (with full page data + version) and `changedPages`
 * (before/after, partitioned by table) for the realtime layer to broadcast.
 *
 * Pages are partitioned by {@link DatabaseTableId} so one Durable Object can host
 * many SQLite databases. Storage uses two data tables:
 *
 * - `database_tables(sqlite_id, table_id, kind, table_name, schema_version, access_policy, source_table_id, target_table_id, file_size_in_pages, last_version)`
 *   maps each external string id to a small integer and stores the table's
 *   registration — see the migration in
 *   `database_durable_object_sql_migrations.ts` for the column semantics.
 * - `database_table_pages(sqlite_id, page_index, version, data)` stores the latest
 *   image of each page, keyed by `(sqlite_id, page_index)`. A `NULL` `data` marks
 *   a tombstone (left behind by truncates) which is surfaced as a missing page
 *   from {@link readPage}.
 *
 * The `sqlite_id` is purely an internal storage optimization and never leaks out
 * of this class.
 *
 * Versions are global across tables: a single counter is bumped once per {@link
 * writePages} call, and every row inserted by that call is stamped with the new
 * value.
 *
 * All per-table access metadata (kind, policy copies, join topology) lives in the
 * `database_tables` store, written by create flows through the server action
 * context and read back synchronously by the authorizer's per-statement lookup —
 * there is no in-memory copy to keep fresh. This store never replicates to
 * clients, which is what allows plaintext names and policies in it.
 */
export class DatabaseServer {
    // Assigned in `create` right after construction: `Database.create` reads pages
    // through this instance, so the instance must exist before the database does.
    private database: Database | null = null;
    private readonly storage: DurableObjectStorage;
    private readonly sql: SqlStorage;
    // Committed in-memory mirrors of the `database_tables.sqlite_id` and
    // `.file_size_in_pages` columns, populated at bootstrap and kept in sync as writes
    // commit. While a transaction is open its pending values live in
    // `currentTransaction` instead and are folded in only on commit.
    private readonly sqliteIds = new Map<DatabaseTableId, number>();
    private readonly fileSizes = new Map<DatabaseTableId, number>();
    // Pending `sqliteIds`/`fileSizes` overlays staged by the in-flight storage
    // transaction, or `undefined` when none is open. Reads consult it first
    // (`currentTransaction?.x ?? this.x`) so a transaction sees its own uncommitted
    // writes; on commit the overlays fold into the mirrors above, on rollback they're
    // dropped.
    private currentTransaction:
        | {
              sqliteIds: Map<DatabaseTableId, number>;
              fileSizes: Map<DatabaseTableId, number>;
          }
        | undefined;
    private lastSnapshotVersion: number | undefined;

    private constructor(storage: DurableObjectStorage) {
        this.storage = storage;
        this.sql = storage.sql;
    }

    private getDatabase(): Database {
        return assertExists(this.database);
    }

    static async create(storage: DurableObjectStorage): Promise<DatabaseServer> {
        runDatabaseDurableObjectSqlMigrations(storage);
        const server = new DatabaseServer(storage);
        server.database = await Database.create(server, {
            server: {
                tables: {
                    // Stamp the registration with the migration count its create flow is about to
                    // apply — every create flow registers, attaches, and migrates to current within
                    // the same action (and the same storage transaction), so the mirror is correct the
                    // moment the action commits.
                    registerTable: (tableId, registration) =>
                        server.registerDatabaseTable(tableId, {
                            ...registration,
                            schemaVersion:
                                registration.kind === "table"
                                    ? tableSqliteMigrations(tableId).length
                                    : joinTableSqliteMigrations(tableId).length,
                        }),
                    setTableName: (tableId, tableName) =>
                        server.setDatabaseTableName(tableId, tableName),
                    setTableAccessPolicy: (tableId, accessPolicy, revision) =>
                        server.setDatabaseTableAccessPolicy(tableId, accessPolicy, revision),
                    isTableNameTaken: (tableName, excludeTableId) =>
                        server.isDatabaseTableNameTaken(tableName, excludeTableId),
                },
            },
        });
        server.bootstrap();
        return server;
    }

    /**
     * Run raw SQL against the canonical database and drain the buffer, returning the
     * full page/version envelope. Test-only: production runs typed actions through
     * {@link executeAction}, so this exists purely to let tests exercise the
     * run-and-persist path with arbitrary SQL and write levels.
     */
    executeForTests(
        context: WorkerActionContext,
        query: SqlQuery,
        options: {allowWrites: SqliteWriteLevel},
    ): DatabaseServerResult {
        assert(import.meta.jest, "executeForTests is test-only");
        const {result, readPages, changedPages, snapshotVersion} = this.runAndPersist(
            context,
            () => {
                const {rows, readPages} = this.getDatabase().executeSql(query, {
                    ...options,
                    getTableAccessLevel: this.getTableAccessLevelForContext(context),
                });
                return {result: rows, readPages};
            },
        );
        return {rows: result, readPages, changedPages, snapshotVersion};
    }

    executeAction<N extends DatabaseActionName>(
        context: WorkerActionContext,
        actionObject: DatabaseActionObject<N>,
    ): DatabaseServerActionResult<N> {
        // `internalOnly` actions are schema/metadata mutations reserved for internal
        // server code, which authorized the operation before forwarding it — gate them on
        // the actor's provenance (see {@link isInternalDatabaseServiceActor}).
        const action = databaseActions[actionObject.name];
        if (action.internalOnly && !isInternalDatabaseServiceActor(context.actor)) {
            throw new PermissionDeniedError(
                `Database action ${actionObject.name} is internal-only`,
            );
        }
        const currentAccountId = context.actor.getPossiblyBotAccountIdIfExists();
        // `internalOnly` actions (already gated to internal callers above) run with a full
        // per-table grant: these are schema/registry mutations — creating a table writes
        // the shared registry and a file whose schema isn't yet mapped to a per-table
        // policy, which the authorizer can only permit by skipping the per-table layer.
        // Being `internalOnly` _is_ the signal that an action is a system operation with
        // no per-account scope. Everything else is enforced against the acting account
        // (see {@link \getTableAccessLevelForContext}).
        const getTableAccessLevel = action.internalOnly
            ? allowAllTableAccess
            : this.getTableAccessLevelForContext(context);
        return this.runAndPersist(context, () =>
            this.getDatabase().executeAction(actionObject, {
                currentAccountId,
                getTableAccessLevel,
            }),
        );
    }

    /**
     * The access level `accountId` has on `tableId`, derived synchronously from the
     * table's registration in storage.
     *
     * - User tables use their `LocalAccessPolicy` copy directly.
     * - Join files derive from the two joined tables: the max level of either side.
     *   (The add-vs-remove asymmetry — adding a link needs `View` on the linked table
     *   — is enforced by `addLink`'s `rowExists` read, not here; see {@link
     *   AccessLevel}.)
     * - Unknown/unregistered tables fail closed. The realtime layer reuses this for
     *   page filtering.
     */
    getTableAccessLevelForAccount(
        tableId: DatabaseTableId,
        accountId: AccountId | null,
    ): AccessLevel | null {
        const entry = this.getDatabaseTableAccessEntry(tableId);
        if (entry === null) return null;
        switch (entry.kind) {
            case "table":
                return accessLevelForPolicy(entry.accessPolicy, accountId);
            case "join": {
                const sourceLevel = this.getSideTableAccessLevel(entry.sourceTableId, accountId);
                const targetLevel = this.getSideTableAccessLevel(entry.targetTableId, accountId);
                return maxAccessLevel(sourceLevel, targetLevel);
            }
            default:
                throw exhaustive(entry);
        }
    }

    /**
     * The per-table access function for SQL run on behalf of `context`. Access is
     * enforced against the acting account, independent of provenance — so a session
     * forwarded by `AppService` (e.g. a server-side-rendered read) is restricted the
     * same as the equivalent browser read. `System` actors run with a full grant
     * instead: space-wide authority with no account (e.g. a background job). A
     * browser/session never reaches here as `System` — the websocket `Main` route
     * requires `authorizeSession()`.
     */
    private getTableAccessLevelForContext(
        context: WorkerActionContext,
    ): (tableId: DatabaseTableId) => AccessLevel | null {
        if (context.actor.type === "System") return allowAllTableAccess;
        const currentAccountId = context.actor.getPossiblyBotAccountIdIfExists();
        return tableId => this.getTableAccessLevelForAccount(tableId, currentAccountId);
    }

    close(): void {
        this.getDatabase().close();
    }

    /** Test-only: raw SQLite handle. */
    unsafeGetDbForTests(): SqliteDatabase {
        assert(import.meta.jest);
        return this.getDatabase().unsafeGetDbForTests();
    }

    /**
     * Test-only: drain any buffered writes accumulated by direct {@link
     * unsafeGetDbForTests} use to durable storage. Production paths drain
     * automatically as part of {@link execute}/{@link executeAction}; tests that write
     * through the raw handle and then inspect storage directly need this to
     * materialize the writes first.
     */
    commitBufferForTests(): void {
        assert(import.meta.jest);
        this.persistBuffer();
    }

    // -- Durable storage ------------------------------------------------------

    transactionSync<T>(fn: () => T): T {
        // Calls made inside an existing server transaction share its atomic boundary.
        // `writePages` uses this to make direct/bootstrap drains transactional without
        // nesting a Durable Object storage transaction during normal action execution.
        if (this.currentTransaction !== undefined) {
            return fn();
        }

        const currentTransaction = {
            sqliteIds: new Map<DatabaseTableId, number>(),
            fileSizes: new Map<DatabaseTableId, number>(),
        };
        const lastSnapshotVersion = this.lastSnapshotVersion;
        this.currentTransaction = currentTransaction;
        try {
            let result: T;
            try {
                result = this.storage.transactionSync(fn);
            } catch (error) {
                // `nextSnapshotVersion` advances before writes so every row in a batch receives
                // one stamp. A rolled-back stamp must not escape through `snapshotVersion`: after
                // a restart, storage could otherwise reuse it.
                this.lastSnapshotVersion = lastSnapshotVersion;
                throw error;
            }
            for (const [tableId, sqliteId] of currentTransaction.sqliteIds) {
                this.sqliteIds.set(tableId, sqliteId);
            }
            for (const [tableId, fileSize] of currentTransaction.fileSizes) {
                this.fileSizes.set(tableId, fileSize);
            }
            return result;
        } finally {
            this.currentTransaction = undefined;
        }
    }

    /**
     * A registered table's access metadata, or `null` when the id is unknown or not
     * yet registered (callers fail closed).
     */
    getDatabaseTableAccessEntry(tableId: DatabaseTableId): DatabaseServerTableAccessEntry | null {
        // `kind IS NOT NULL` drops unregistered rows (created by a bare page write or an
        // early policy push) — they resolve to no entry, fail closed, same as a missing
        // row.
        return sql`
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
    }

    /**
     * Every registered table, for access-map building and the bootstrap migration
     * sweep.
     */
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
        return (
            sql`
                SELECT
                    access_policy
                FROM
                    database_tables
                WHERE
                    table_id = ${tableId}
            `.selectValueIfExists(this.sql, accessPolicyColumnSchema) ?? null
        );
    }

    setDatabaseTableAccessPolicy(
        tableId: DatabaseTableId,
        accessPolicy: LocalAccessPolicy | null,
        revision: DatabaseTableAccessPolicyRevision,
    ): boolean {
        const applied = sql`
            INSERT INTO
                database_tables (
                    table_id,
                    access_policy,
                    access_policy_table_version,
                    access_policy_source_version
                )
            VALUES
                (
                    ${tableId},
                    ${accessPolicyColumnSchema.serialize(accessPolicy)},
                    ${revision.tableMetadataVersion},
                    ${revision.sourcePolicyVersion}
                )
            ON CONFLICT (table_id) DO UPDATE
            SET
                access_policy = excluded.access_policy,
                access_policy_table_version = excluded.access_policy_table_version,
                access_policy_source_version = excluded.access_policy_source_version
            WHERE
                excluded.access_policy_table_version > database_tables.access_policy_table_version
                OR (
                    excluded.access_policy_table_version = database_tables.access_policy_table_version
                    AND excluded.access_policy_source_version > database_tables.access_policy_source_version
                )
            RETURNING
                1
        `.selectValueIfExists(this.sql, Schema.integer);
        return applied !== null;
    }

    /**
     * Update the mirrored migration version after the bootstrap sweep migrates a file.
     */
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

    /**
     * Apply a batch of buffered writes atomically.
     *
     * - `pages` — page after-images keyed by table, then by zero-based page index.
     * - `truncates` — post-truncate file sizes in bytes, keyed by table. Every page at
     *   or past the boundary becomes a tombstone at the same version stamped on the
     *   batch's writes.
     *
     * Truncates are applied before page writes so a write past a truncate boundary
     * correctly re-extends the file. Returns the monotonically increasing version
     * stamped on every row touched in this batch.
     */
    writePages(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): number {
        if (this.currentTransaction === undefined) {
            return this.transactionSync(() => this.writePages(pages, truncates));
        }

        const version = this.nextSnapshotVersion();

        const finalPagesByTable = new Map<DatabaseTableId, Map<number, Uint8Array | null>>();
        const finalFileSizeByTable = new Map<DatabaseTableId, number>();

        // Compute the complete final state before persisting any page. In particular, a
        // rewrite later in this batch replaces a truncate tombstone for the same primary
        // key rather than attempting two writes at one version.
        for (const [databaseTableId, size] of truncates) {
            const sqliteId = this.getOrCreateSqliteId(databaseTableId);
            const maxPageIndex = Math.floor(size / sqlitePageSize);
            // This range scan is deliberate: tombstones must be retained for every known page
            // removed by the truncate. The `(sqlite_id, page_index)` primary key serves the
            // range directly.
            const pageIndexes = sql`
                SELECT
                    page_index
                FROM
                    database_table_pages
                WHERE
                    sqlite_id = ${sqliteId}
                    AND page_index >= ${maxPageIndex}
            `.selectValues(this.sql, Schema.integer);
            const finalPages = new Map<number, Uint8Array | null>();
            for (const pageIndex of pageIndexes) {
                finalPages.set(pageIndex, null);
            }
            finalPagesByTable.set(databaseTableId, finalPages);
            finalFileSizeByTable.set(databaseTableId, size);
        }

        for (const [databaseTableId, tablePages] of pages) {
            const finalPages = finalPagesByTable.get(databaseTableId) ?? new Map();
            finalPagesByTable.set(databaseTableId, finalPages);
            let finalFileSize =
                finalFileSizeByTable.get(databaseTableId) ?? this.getFileSize(databaseTableId);
            for (const [index, data] of tablePages) {
                finalPages.set(index, data);
                const end = (index + 1) * sqlitePageSize;
                finalFileSize = Math.max(finalFileSize, end);
            }
            finalFileSizeByTable.set(databaseTableId, finalFileSize);
        }

        for (const [databaseTableId, finalFileSize] of finalFileSizeByTable) {
            const sqliteId = this.getOrCreateSqliteId(databaseTableId);
            const finalPages = finalPagesByTable.get(databaseTableId);
            assert(finalPages !== undefined, `missing final pages for table ${databaseTableId}`);
            assert(
                finalFileSize % sqlitePageSize === 0,
                `unaligned file size for table ${databaseTableId}: ${finalFileSize}`,
            );
            for (const [pageIndex, data] of finalPages) {
                sql`
                    INSERT INTO
                        database_table_pages (sqlite_id, page_index, version, data)
                    VALUES
                        (
                            ${sqliteId},
                            ${pageIndex},
                            ${version},
                            ${data}
                        )
                    ON CONFLICT (sqlite_id, page_index) DO UPDATE
                    SET
                        version = excluded.version,
                        data = excluded.data
                `.exec(this.sql);
            }
            sql`
                UPDATE database_tables
                SET
                    file_size_in_pages = ${finalFileSize / sqlitePageSize},
                    last_version = ${version}
                WHERE
                    sqlite_id = ${sqliteId}
            `.exec(this.sql);
            this.currentTransaction.fileSizes.set(databaseTableId, finalFileSize);
        }

        return version;
    }

    getFileSize(databaseTableId: DatabaseTableId): number {
        const cached =
            this.currentTransaction?.fileSizes.get(databaseTableId) ??
            this.fileSizes.get(databaseTableId);
        if (cached !== undefined) {
            return cached;
        }
        const fileSizeInPages = sql`
            SELECT
                file_size_in_pages
            FROM
                database_tables
            WHERE
                table_id = ${databaseTableId}
        `.selectValueIfExists(this.sql, Schema.integer);
        const size = (fileSizeInPages ?? 0) * sqlitePageSize;
        (this.currentTransaction?.fileSizes ?? this.fileSizes).set(databaseTableId, size);
        return size;
    }

    /** Current global page snapshot version. */
    getSnapshotVersion(): number {
        if (this.lastSnapshotVersion === undefined) {
            // Cold load deliberately scans the compact per-table metadata, rather than all
            // retained page images, so the next global stamp is strictly greater than any
            // persisted table version.
            this.lastSnapshotVersion =
                sql`
                    SELECT
                        MAX(last_version)
                    FROM
                        database_tables
                `.selectValue(this.sql, Schema.integer.nullable()) ?? 0;
        }
        return this.lastSnapshotVersion;
    }

    /**
     * Latest page states changed after a client's per-table global-version cursor.
     */
    changedPagesSince(
        databaseTableId: DatabaseTableId,
        sinceVersion: number,
    ): {
        changedPageIndexes: Set<number>;
        tombstonedPageIndexes: Set<number>;
    } {
        const table = sql`
            SELECT
                sqlite_id,
                last_version
            FROM
                database_tables
            WHERE
                table_id = ${databaseTableId}
        `.selectOneOrNone(this.sql, {
            sqliteId: Schema.integer.originalPropertyKey("sqlite_id"),
            lastVersion: Schema.integer.originalPropertyKey("last_version"),
        });
        const changedPageIndexes = new Set<number>();
        const tombstonedPageIndexes = new Set<number>();
        if (table === null || table.lastVersion <= sinceVersion) {
            return {changedPageIndexes, tombstonedPageIndexes};
        }

        const rows = sql`
            SELECT
                page_index,
                data IS NULL AS tombstoned
            FROM
                database_table_pages
            WHERE
                sqlite_id = ${table.sqliteId}
                AND version > ${sinceVersion}
        `.selectAll(this.sql, {
            pageIndex: Schema.integer.originalPropertyKey("page_index"),
            tombstoned: Schema.integer,
        });
        for (const row of rows) {
            (row.tombstoned === 1 ? tombstonedPageIndexes : changedPageIndexes).add(row.pageIndex);
        }
        return {changedPageIndexes, tombstonedPageIndexes};
    }

    // -- Internal -----------------------------------------------------------

    /**
     * Record a newly created table's registration. Upserts: the row may already exist
     * from an earlier page write or policy push.
     */
    private registerDatabaseTable(
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
                    ${accessPolicyColumnSchema.serialize(
                registration.kind === "table" ? registration.accessPolicy : null,
            )},
                    ${registration.kind === "join" ? registration.sourceTableId : null},
                    ${registration.kind === "join" ? registration.targetTableId : null}
                )
            ON CONFLICT (table_id) DO UPDATE
            SET
                kind = excluded.kind,
                table_name = excluded.table_name,
                schema_version = excluded.schema_version,
                access_policy = COALESCE(
                    database_tables.access_policy,
                    excluded.access_policy
                ),
                source_table_id = excluded.source_table_id,
                target_table_id = excluded.target_table_id
        `.exec(this.sql);
    }

    /** Record a rename's resolved SQLite `table_name`. */
    private setDatabaseTableName(tableId: DatabaseTableId, tableName: string): void {
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

    /**
     * Whether any table's `table_name` equals `tableName`, optionally excluding one
     * id.
     */
    private isDatabaseTableNameTaken(tableName: string, excludeTableId?: DatabaseTableId): boolean {
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

    private nextSnapshotVersion(): number {
        const nextSnapshotVersion = this.getSnapshotVersion() + 1;
        this.lastSnapshotVersion = nextSnapshotVersion;
        return nextSnapshotVersion;
    }

    /**
     * Resolve `databaseTableId` to its internal `sqlite_id`, returning `undefined` if
     * no row exists yet. Used by read paths so an unwritten table doesn't silently
     * register a `sqlite_id`.
     */
    private lookupSqliteId(databaseTableId: DatabaseTableId): number | undefined {
        const cached =
            this.currentTransaction?.sqliteIds.get(databaseTableId) ??
            this.sqliteIds.get(databaseTableId);
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
        (this.currentTransaction?.sqliteIds ?? this.sqliteIds).set(databaseTableId, sqliteId);
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
        (this.currentTransaction?.sqliteIds ?? this.sqliteIds).set(databaseTableId, sqliteId);
        return sqliteId;
    }

    /**
     * A joined table's access level for `accountId`, `null` when denied/unknown.
     */
    private getSideTableAccessLevel(
        tableId: DatabaseTableId,
        accountId: AccountId | null,
    ): AccessLevel | null {
        const entry = this.getDatabaseTableAccessEntry(tableId);
        if (entry === null || entry.kind !== "table") return null;
        return accessLevelForPolicy(entry.accessPolicy, accountId);
    }

    private bootstrap(): void {
        // Bootstrap writes flow through the buffer like any other execute; each batch
        // drains to storage right after. Migration runners open no transaction of their
        // own, so wrap each run in one here — a failed migration then rolls back
        // atomically with its `user_version` bump instead of leaving the pager
        // half-migrated.
        this.getDatabase().execute(
            db => {
                db.exec("PRAGMA quick_check");
                executeSqliteTransaction(db, () => runMainMigrations(db));
            },
            {
                allowWrites: "schema+data",
                getTableAccessLevel: allowAllTableAccess,
            },
        );
        this.persistBuffer();

        // Migrate stale per-table files, one execute + persist per table. The table
        // store's schema_version mirrors each file's user_version, so a current table is
        // skipped without ever attaching it — bootstrap costs O(stale tables), and cold
        // starts after a no-migration deploy attach nothing. Attach-on-miss assumes every
        // registered file is migration-current, so this sweep must finish before any
        // action runs. Persisting per table keeps migrated files' buffered writes drained
        // — Database only evicts tables with an empty buffer, and for groups with more
        // stale tables than the attach threshold the sweep relies on that LRU eviction to
        // stay under SQLite's limit.
        for (const table of this.listDatabaseTables()) {
            const migrationCount =
                table.kind === "table"
                    ? tableSqliteMigrations(table.tableId).length
                    : joinTableSqliteMigrations(table.tableId).length;
            if (table.schemaVersion === migrationCount) continue;
            this.getDatabase().execute(
                db => {
                    this.getDatabase().attachIfNeeded(table.tableId);
                    executeSqliteTransaction(db, () => {
                        switch (table.kind) {
                            case "table":
                                runTableMigrations(db, table.tableId);
                                break;
                            case "join":
                                runJoinTableMigrations(db, table.tableId);
                                break;
                            default:
                                throw exhaustive(table.kind);
                        }
                    });
                },
                {
                    allowWrites: "schema+data",
                    getTableAccessLevel: allowAllTableAccess,
                },
            );
            this.persistBuffer();
            // Repair the mirror only after the migrated pages are durable — a crash in between
            // re-runs an already-applied (no-op) migration next boot rather than skipping a
            // stale file.
            this.setDatabaseTableSchemaVersion(table.tableId, migrationCount);
        }
    }

    private runAndPersist<T>(
        context: WorkerActionContext,
        run: () => {result: T; readPages: ReadonlyDatabasePageSet},
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
        snapshotVersion: number;
    } {
        // The error path below clears the buffer to recover from a partial write; assert
        // up front that we're not silently throwing away pre-existing buffered writes
        // belonging to a prior (forgotten) drain.
        this.getDatabase().assertBufferIsEmpty("runAndPersist");
        try {
            return this.transactionSync(() => {
                const {result, readPages} = run();
                return this.persistAndBuildResult(result, readPages);
            });
        } catch (error) {
            // Drop any partial buffered writes — whether the tracked execute or the drain
            // failed — so storage and SQLite's pager cache stay in sync and the next execute
            // starts from an empty buffer. `discardBuffer` is a safe no-op if the drain
            // already committed. Table-store writes the failed action issued roll back with
            // the storage transaction.
            this.getDatabase().discardBuffer();
            throw error;
        }
    }

    private persistAndBuildResult<T>(
        result: T,
        readPagesSet: ReadonlyDatabasePageSet,
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
        snapshotVersion: number;
    } {
        const buffered = this.getDatabase().getBufferedWrites();

        // Capture the pre-mutation `before` image for every buffered page from storage
        // _before_ draining.
        //
        // `changedPages` is built from `buffered.pages` only, so a table with a buffered
        // truncate but no buffered page write would be dropped from the realtime broadcast
        // (its shrunk `fileSizeInPages` never sent). That can't happen today: SQLite
        // rewrites a low page (the header / change counter) on every transaction that also
        // truncates, so every truncated table also has a buffered page write. Assert that
        // invariant rather than handle a truncate-only table that no SQL path can
        // currently produce — if this ever fires, the build-from-`pages`-only logic below
        // needs to fold in `buffered.truncates` too.
        const changedPages: DatabaseServerChangedPages = new Map();
        if (buffered !== null) {
            for (const tableId of buffered.truncates.keys()) {
                assert(
                    buffered.pages.has(tableId),
                    `truncate-only table ${tableId} would be dropped from changedPages`,
                );
            }
            for (const [tableId, tablePages] of buffered.pages) {
                const pages = new Map<number, DatabaseServerPageChange>();
                for (const [pageIndex, after] of tablePages) {
                    const stored = this.readPage(tableId, pageIndex);
                    const before = stored !== null ? stored.data : new Uint8Array(sqlitePageSize);
                    pages.set(pageIndex, {
                        before: new Uint8Array(before),
                        after: new Uint8Array(after),
                        beforeVersion: stored !== null ? stored.version : 0,
                    });
                }
                // `fileSizesInPages` already reflects the post-drain logical size (Database folds
                // in buffered truncates + max page index), so we can stamp it in pre-drain.
                const fileSizeInPages = buffered.fileSizesInPages.get(tableId);
                assert(
                    fileSizeInPages !== undefined,
                    `missing fileSizeInPages for table ${tableId}`,
                );
                changedPages.set(tableId, {pages, fileSizeInPages});
            }
        }

        const postWriteVersion = this.persistBuffer();

        // Build the readPages map with full page data + version per table. For pages that
        // were just written, use the after-image plus the freshly- assigned write version;
        // for the rest, fetch from storage.
        const readPages: DatabaseServerReadPages = new Map();
        for (const [tableId, indexes] of readPagesSet) {
            const tableMap = new Map<number, {data: Uint8Array; version: number}>();
            const tableChanges = changedPages.get(tableId)?.pages;
            for (const pageIndex of indexes) {
                const change = tableChanges?.get(pageIndex);
                if (change !== undefined) {
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(change.after),
                        version: postWriteVersion,
                    });
                } else {
                    const page = this.readPage(tableId, pageIndex);
                    // A read page that reads back `null` post-drain was truncated away by this same
                    // batch: the VFS only adds a page to the read set when the read returned real
                    // data, so `null` here means the batch's truncate tombstoned it. The server
                    // considers it gone — omit it rather than fabricating a zero-filled, version-0
                    // page for an index past the new end of file. Clients learn of the shrink via
                    // `fileSizeInPages`.
                    if (page === null) continue;
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(page.data),
                        version: page.version,
                    });
                }
            }
            readPages.set(tableId, tableMap);
        }

        // The realtime layer pulls the version for each changed page out of `readPages`,
        // so make sure every changed page is represented there even if SQLite never read
        // it back during execution.
        for (const [tableId, entry] of changedPages) {
            let tableMap = readPages.get(tableId);
            if (tableMap === undefined) {
                tableMap = new Map();
                readPages.set(tableId, tableMap);
            }
            for (const [pageIndex, change] of entry.pages) {
                if (!tableMap.has(pageIndex)) {
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(change.after),
                        version: postWriteVersion,
                    });
                }
            }
        }

        // Always include page 0 for every table in the result. SQLite usually serves the
        // header/schema page from its pager cache (and skips schema-cookie reads entirely
        // in exclusive locking mode), so the tracked read set rarely contains it — but a
        // client can't ATTACH a table it fetched over the wire without the header page.
        for (const [tableId, tableMap] of readPages) {
            if (tableMap.has(0)) continue;
            const page0 = this.readPage(tableId, 0);
            if (page0 !== null) {
                tableMap.set(0, {
                    data: new Uint8Array(page0.data),
                    version: page0.version,
                });
            }
        }

        return {
            result,
            readPages,
            changedPages,
            snapshotVersion: this.getSnapshotVersion(),
        };
    }

    /**
     * Drain the buffer's truncates and page writes into durable storage and clear it.
     * Returns the version stamped on the batch (0 if the buffer was empty).
     */
    private persistBuffer(): number {
        const buffered = this.getDatabase().getBufferedWrites();
        if (buffered === null) return 0;
        const version = this.writePages(buffered.pages, buffered.truncates);
        this.getDatabase().markCommitted();
        return version;
    }
}

/**
 * Evaluate a table policy copy for an account. The table store only ever holds
 * `Local` policies (the RPC layer resolves `Site` policies before issuing
 * `createTable`/`syncTableMetadata` — see `intoEffectiveAccessPolicy`); a missing
 * policy fails closed. Space membership was authorized at the connection/request
 * boundary, which is exactly the assumption
 * `getAccountAccessLevelAssumingSpaceAccess` requires.
 */
function accessLevelForPolicy(
    accessPolicy: LocalAccessPolicy | null,
    accountId: AccountId | null,
): AccessLevel | null {
    if (accessPolicy === null) return null;
    return getAccountAccessLevelAssumingSpaceAccess(accessPolicy, accountId);
}

/**
 * The `access_policy` column: a resolved local policy copy stored as JSON text.
 */
const accessPolicyColumnSchema = SqlJsonSchema(LocalAccessPolicySchema).nullable();

/**
 * Row shape for {@link DatabaseServer.getDatabaseTableAccessEntry}, discriminated
 * on the registration `kind` (the CHECK constraint in
 * `database_durable_object_sql_migrations.ts` guarantees each variant's columns).
 */
const databaseTableRowSchema = Schema.unionWithKey("kind", {
    table: Schema.object({
        kind: Schema.value("table"),
        accessPolicy: accessPolicyColumnSchema.originalPropertyKey("access_policy"),
    }),
    join: Schema.object({
        kind: Schema.value("join"),
        sourceTableId: Schema.id<DatabaseTableId>().originalPropertyKey("source_table_id"),
        targetTableId: Schema.id<DatabaseTableId>().originalPropertyKey("target_table_id"),
    }),
});
