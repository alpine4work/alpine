import type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {isInternalDatabaseServiceActor} from "~/server/databases/is_internal_database_service_actor.js";
import {
    type AccessLevel,
    type LocalAccessPolicy,
    getAccountAccessLevelAssumingSpaceAccess,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {allowAllTableAccess} from "~/shared/databases/allow_all_table_access.js";
import {Database, type DatabaseTrackedExecution} from "~/shared/databases/database.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import {type SqlQuery} from "~/shared/databases/sql.js";
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
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {AccountId, DatabaseTableId} from "~/shared/id/types/id_types.js";

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

export interface DatabaseServerResult {
    rows: Array<Record<string, unknown>>;
    readPages: DatabaseServerReadPages;
    changedPages: DatabaseServerChangedPages;
    writeVersion: number;
}

export type DatabaseServerActionResult<N extends DatabaseActionName> = {
    result: DatabaseActionOutput<N>;
    readPages: DatabaseServerReadPages;
    changedPages: DatabaseServerChangedPages;
    writeVersion: number;
};

/**
 * Canonical SQLite database backed by a {@link DatabaseServerStorage}
 * implementation.
 *
 * Wraps a {@link Database}: SQL execution, page tracking, authorization, and the
 * in-memory write buffer all live there. The server's job is to glue that buffer
 * to durable storage — every {@link execute}/{@link executeAction} call captures
 * pre-mutation page snapshots, drains the buffer to {@link DatabaseServerStorage},
 * and surfaces `readPages` (with full page data + version) and `changedPages`
 * (before/after, partitioned by table) for the realtime layer to broadcast.
 *
 * All per-table access metadata (kind, policy copies, join topology) lives in the
 * storage's table store, written by create flows through the server action context
 * and read back synchronously by the authorizer's per-statement lookup — there is
 * no in-memory copy to keep fresh.
 */
export class DatabaseServer {
    private readonly database: Database;
    private readonly storage: DatabaseServerStorage;

    private constructor(database: Database, storage: DatabaseServerStorage) {
        this.database = database;
        this.storage = storage;
    }

    static async create(storage: DatabaseServerStorage): Promise<DatabaseServer> {
        const database = await Database.create(storage, {
            server: {
                tables: {
                    // Stamp the registration with the migration count its create flow is about to
                    // apply — every create flow registers, attaches, and migrates to current within
                    // the same action (and the same storage transaction), so the mirror is correct the
                    // moment the action commits.
                    registerTable: (tableId, registration) =>
                        storage.registerDatabaseTable(tableId, {
                            ...registration,
                            schemaVersion:
                                registration.kind === "table"
                                    ? tableSqliteMigrations(tableId).length
                                    : joinTableSqliteMigrations(tableId).length,
                        }),
                    setTableName: (tableId, tableName) =>
                        storage.setDatabaseTableName(tableId, tableName),
                    setTableAccessPolicy: (tableId, accessPolicy) =>
                        storage.setDatabaseTableAccessPolicy(tableId, accessPolicy),
                    isTableNameTaken: (tableName, excludeTableId) =>
                        storage.isDatabaseTableNameTaken(tableName, excludeTableId),
                },
            },
        });
        const server = new DatabaseServer(database, storage);
        server._bootstrap();
        return server;
    }

    execute(
        context: WorkerActionContext,
        query: SqlQuery,
        options: {allowWrites: SqliteWriteLevel},
    ): DatabaseServerResult {
        const {result, readPages, changedPages, writeVersion} = this._runAndPersist(context, () => {
            const currentAccountId = context.actor.getPossiblyBotAccountIdIfExists();
            const {rows, readPages} = this.database.executeSql(query, {
                ...options,
                getTableAccessLevel:
                    context.actor.type === "System"
                        ? allowAllTableAccess
                        : tableId => this.getTableAccessLevelForAccount(tableId, currentAccountId),
                enforceTableAccess: context.actor.type !== "System",
            });
            return {result: rows, readPages};
        });
        return {rows: result, readPages, changedPages, writeVersion};
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
        // Per-table access is enforced against the acting account, independent of
        // provenance — so a session forwarded by `AppService` (e.g. a server-side-rendered
        // read) is restricted the same as the equivalent browser read. Two cases run with
        // a full grant instead:
        //
        // - `internalOnly` actions (already gated to internal callers above): these are
        //   schema/registry mutations — creating a table writes the shared registry and a
        //   file whose schema isn't yet mapped to a per-table policy, which the authorizer
        //   can only permit by skipping the per-table layer. Being `internalOnly` _is_ the
        //   signal that an action is a system operation with no per-account scope.
        // - `System` actors: space-wide authority with no account (e.g. a background job).
        //   A browser/session never reaches here as `System` — the websocket `Main` route
        //   requires `authorizeSession()`.
        const getTableAccessLevel =
            action.internalOnly || context.actor.type === "System"
                ? allowAllTableAccess
                : (tableId: DatabaseTableId) =>
                      this.getTableAccessLevelForAccount(tableId, currentAccountId);
        const enforceTableAccess = !action.internalOnly && context.actor.type !== "System";
        return this._runAndPersist(context, () =>
            this.database.executeAction(actionObject, {
                currentAccountId,
                getTableAccessLevel,
                enforceTableAccess,
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
        const entry = this.storage.getDatabaseTableAccessEntry(tableId);
        if (entry === null) return null;
        switch (entry.kind) {
            case "table":
                return accessLevelForPolicy(entry.accessPolicy, accountId);
            case "join": {
                const sourceLevel = this._getSideTableAccessLevel(entry.sourceTableId, accountId);
                const targetLevel = this._getSideTableAccessLevel(entry.targetTableId, accountId);
                return maxAccessLevel(sourceLevel, targetLevel);
            }
            default:
                throw exhaustive(entry);
        }
    }

    createTrackedExecution<Value>(fn: () => Value): DatabaseTrackedExecution<Value> {
        return this.database.createTrackedExecution(fn);
    }

    close(): void {
        this.database.close();
    }

    /** Test-only: raw SQLite handle. */
    unsafeGetDbForTests(): SqliteDatabase {
        assert(import.meta.jest);
        return this.database.unsafeGetDbForTests();
    }

    /**
     * Test-only: drain any buffered writes accumulated by direct {@link
     * unsafeGetDbForTests} use to durable storage. Production paths drain
     * automatically as part of {@link execute}/{@link executeAction}; tests that write
     * through the raw handle and then inspect `storage` directly need this to
     * materialize the writes first.
     */
    commitBufferForTests(): void {
        assert(import.meta.jest);
        this._persistBuffer();
    }

    // -- Internal -----------------------------------------------------------

    /**
     * A joined table's access level for `accountId`, `null` when denied/unknown.
     */
    private _getSideTableAccessLevel(
        tableId: DatabaseTableId,
        accountId: AccountId | null,
    ): AccessLevel | null {
        const entry = this.storage.getDatabaseTableAccessEntry(tableId);
        if (entry === null || entry.kind !== "table") return null;
        return accessLevelForPolicy(entry.accessPolicy, accountId);
    }

    private _bootstrap(): void {
        // Bootstrap writes flow through the buffer like any other execute; each batch
        // drains to storage right after.
        this.database.execute(
            db => {
                db.exec("PRAGMA quick_check");
                runMainMigrations(db);
            },
            {
                allowWrites: "schema+data",
                getTableAccessLevel: allowAllTableAccess,
                enforceTableAccess: false,
            },
        );
        this._persistBuffer();

        // Migrate stale per-table files, one execute + persist per table. The table
        // store's schema_version mirrors each file's user_version, so a current table is
        // skipped without ever attaching it — bootstrap costs O(stale tables), and cold
        // starts after a no-migration deploy attach nothing. Attach-on-miss assumes every
        // registered file is migration-current, so this sweep must finish before any
        // action runs. Persisting per table keeps migrated files' buffered writes drained
        // — Database only evicts tables with an empty buffer, and for groups with more
        // stale tables than the attach threshold the sweep relies on that LRU eviction to
        // stay under SQLite's limit.
        for (const table of this.storage.listDatabaseTables()) {
            const migrationCount =
                table.kind === "table"
                    ? tableSqliteMigrations(table.tableId).length
                    : joinTableSqliteMigrations(table.tableId).length;
            if (table.schemaVersion === migrationCount) continue;
            this.database.execute(
                db => {
                    this.database.attachIfNeeded(table.tableId);
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
                },
                {
                    allowWrites: "schema+data",
                    getTableAccessLevel: allowAllTableAccess,
                    enforceTableAccess: false,
                },
            );
            this._persistBuffer();
            // Repair the mirror only after the migrated pages are durable — a crash in between
            // re-runs an already-applied (no-op) migration next boot rather than skipping a
            // stale file.
            this.storage.setDatabaseTableSchemaVersion(table.tableId, migrationCount);
        }
    }

    private _runAndPersist<T>(
        context: WorkerActionContext,
        run: () => {result: T; readPages: ReadonlyDatabasePageSet},
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
        writeVersion: number;
    } {
        // The error path below clears the buffer to recover from a partial write; assert
        // up front that we're not silently throwing away pre-existing buffered writes
        // belonging to a prior (forgotten) drain.
        this.database.assertBufferIsEmpty("_runAndPersist");
        try {
            return this.storage.transactionSync(() => {
                const {result, readPages} = run();
                return this._persistAndBuildResult(result, readPages);
            });
        } catch (error) {
            // Drop any partial buffered writes — whether the tracked execute or the drain
            // failed — so storage and SQLite's pager cache stay in sync and the next execute
            // starts from an empty buffer. `discardBuffer` is a safe no-op if the drain
            // already committed. Table-store writes the failed action issued roll back with
            // the storage transaction.
            this.database.discardBuffer();
            throw error;
        }
    }

    private _persistAndBuildResult<T>(
        result: T,
        readPagesSet: ReadonlyDatabasePageSet,
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
        writeVersion: number;
    } {
        const buffered = this.database.getBufferedWrites();

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
                    const stored = this.storage.readPage(tableId, pageIndex);
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

        const postWriteVersion = this._persistBuffer();

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
                    const page = this.storage.readPage(tableId, pageIndex);
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

        // Always include page 0 for every table in the result, mirroring
        // `ensureCacheIsUpToDate`. SQLite usually serves the header/schema page from its
        // pager cache (and skips schema-cookie reads entirely in exclusive locking mode),
        // so the tracked read set rarely contains it — but a client can't ATTACH a table
        // it fetched over the wire without the header page.
        for (const [tableId, tableMap] of readPages) {
            if (tableMap.has(0)) continue;
            const page0 = this.storage.readPage(tableId, 0);
            if (page0 !== null) {
                tableMap.set(0, {
                    data: new Uint8Array(page0.data),
                    version: page0.version,
                });
            }
        }

        return {result, readPages, changedPages, writeVersion: postWriteVersion};
    }

    /**
     * Drain the buffer's truncates and page writes into durable storage and clear it.
     * Returns the version stamped on the batch (0 if the buffer was empty).
     */
    private _persistBuffer(): number {
        const buffered = this.database.getBufferedWrites();
        if (buffered === null) return 0;
        const version = this.storage.writePages(buffered.pages, buffered.truncates);
        this.database.markCommitted();
        return version;
    }
}

/**
 * Evaluate a table policy copy for an account. The table store only ever holds
 * `Local` policies (the RPC layer resolves `Site` policies before issuing
 * `createTable`/`syncTableMetadata` — see
 * `resolveDatabaseTableAccessPolicyForDurableObject`); a missing policy fails
 * closed. Space membership was authorized at the connection/request boundary,
 * which is exactly the assumption `getAccountAccessLevelAssumingSpaceAccess`
 * requires.
 */
function accessLevelForPolicy(
    accessPolicy: LocalAccessPolicy | null,
    accountId: AccountId | null,
): AccessLevel | null {
    if (accessPolicy === null) return null;
    return getAccountAccessLevelAssumingSpaceAccess(accessPolicy, accountId);
}
