import type {
    MutateServerResult,
    QueryServerResult,
} from "~/client/web/databases/database_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import type {Database, Sqlite3Static} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {InstalledVfs} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";

interface OptimisticMutation {
    mutationId: DatabaseMutationId;
    sql: string;
}

const vfsNamePrefix = "alpine-client";
let vfsCounter = 0;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Represents a connected tab's route to the server.
 * Passed into {@link DatabaseClient.executeQuery} so
 * server fallbacks route through the correct tab's
 * WebSocket connection.
 */
export interface DatabaseClientConnection {
    queryServer(sql: string): Promise<QueryServerResult>;
    mutateServer(sql: string, mutationId: DatabaseMutationId): Promise<MutateServerResult>;
    reportError(error: unknown): void;
}

/**
 * Client-side SQLite database backed by OPFS page
 * storage. Handles server fallback transparently:
 * when a local query hits a missing page, calls
 * {@link DatabaseClientConnection.queryServer} to
 * fetch pages from the server, stores them locally,
 * and returns the server's result.
 *
 * Inject the result of `navigator.storage.getDirectory()`
 * to construct. For tests, pass an in-memory mock.
 */
export class DatabaseClient {
    private readonly db: Database;
    private readonly vfs: InstalledVfs;
    private readonly pageStore: OpfsPageStore;
    private optimisticQueue: Array<OptimisticMutation> = [];

    private constructor(sqlite3: Sqlite3Static, pageStore: OpfsPageStore) {
        this.pageStore = pageStore;
        const vfsName = `${vfsNamePrefix}-${vfsCounter++}`;

        this.vfs = installVfs(sqlite3, vfsName, {
            open: (_filename, flags) => {
                if (flags & sqlite3.capi.SQLITE_OPEN_MAIN_DB) {
                    return pageStore;
                }
                return new VfsTempFile();
            },
            delete: () => {},
            access: () => false,
        });

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "ct", vfsName);
        this.db.exec("PRAGMA page_size = 4096");
        this.db.exec("PRAGMA journal_mode = MEMORY");
    }

    static async create(dir: OpfsDirectoryHandle): Promise<DatabaseClient> {
        if (sqlite3Promise === undefined) {
            sqlite3Promise = sqlite3InitModule();
        }
        const sqlite3 = await sqlite3Promise;

        const dbDir = await dir.getDirectoryHandle("databases", {create: true});
        const pageStore = await OpfsPageStore.create(dbDir);

        return new DatabaseClient(sqlite3, pageStore);
    }

    /**
     * Execute a query. If the local OPFS store is empty or
     * missing pages, transparently falls back to the server
     * via the connection's {@link DatabaseClientConnection.queryServer},
     * stores the returned pages locally, and returns the
     * server result.
     */
    async executeQuery(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        if (this.isEmpty()) {
            try {
                return await this.executeQueryViaServer(conn, sql);
            } catch {
                // Server unavailable — fall through to local
            }
        }
        try {
            return this.executeQueryLocally(sql);
        } catch (error) {
            if (error instanceof PageMissingError) {
                return this.executeQueryViaServer(conn, sql);
            }
            throw error;
        }
    }

    /**
     * Execute a mutation optimistically: run it locally
     * first for instant UI feedback, then send to the
     * server in the background. If local execution hits
     * a missing page, falls back to non-optimistic
     * server execution.
     */
    async executeMutation(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const mutationId = generateId<DatabaseMutationId>();

        let rows: ReadonlyArray<Record<string, unknown>>;
        try {
            rows = this.pageStore.optimistic(() => this.executeQueryLocally(sql));
        } catch (error) {
            if (error instanceof PageMissingError) {
                const result = await conn.mutateServer(sql, mutationId);
                return result.rows as ReadonlyArray<Record<string, unknown>>;
            }
            throw error;
        }

        this.optimisticQueue.push({mutationId, sql});

        // Send to server in the background.
        void (async () => {
            try {
                await conn.mutateServer(sql, mutationId);
                assert(
                    !this.optimisticQueue.some(m => m.mutationId === mutationId),
                    "mutation not confirmed via realtime before server responded",
                );
            } catch (error) {
                this.removeOptimisticMutation(mutationId);
                conn.reportError(error);
            }
        })();

        return rows;
    }

    /**
     * Execute a query while tracking which database pages
     * are read. Uses `pageAccessHook` to capture reads
     * including cache hits. On missing pages, falls back
     * to the server, then retries locally to build an
     * accurate read-set.
     *
     * The hook is only active during synchronous
     * `executeQueryLocally` calls — never across an
     * `await` — so concurrent tracking calls cannot
     * interfere with each other.
     */
    async executeQueryWithTracking(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<{rows: ReadonlyArray<Record<string, unknown>>; readPages: ReadonlySet<number>}> {
        if (this.isEmpty()) {
            try {
                await this.executeQueryViaServer(conn, sql);
            } catch {
                // Server unavailable — fall through to local
            }
        }

        const readPages = new Set<number>();
        const setHook = () => {
            this.db.pageAccessHook((_pArg, pgno, flags) => {
                if (flags === 1) readPages.add(pgno - 1);
            });
        };

        try {
            setHook();
            try {
                return {rows: this.executeQueryLocally(sql), readPages};
            } finally {
                this.db.pageAccessHook(null);
            }
        } catch (error) {
            if (!(error instanceof PageMissingError)) throw error;
            readPages.clear();
            await this.executeQueryViaServer(conn, sql);
            setHook();
            try {
                return {rows: this.executeQueryLocally(sql), readPages};
            } finally {
                this.db.pageAccessHook(null);
            }
        }
    }

    // -- Reactive queries ----------------------------------------------------

    private readonly reactiveQueries = new Map<
        string,
        {
            readonly sql: string;
            readPages: ReadonlySet<number>;
            readonly conn: DatabaseClientConnection;
            readonly notify: (rows: ReadonlyArray<Record<string, unknown>>) => void;
            readonly reportError: (error: unknown) => void;
            reExecuting: boolean;
        }
    >();
    private pagesToInvalidate = new Set<number>();
    private invalidationScheduled = false;

    /**
     * Register a reactive query. Executes the query with
     * page tracking and returns the initial rows. When
     * pages in the query's read-set are subsequently
     * written, the query re-executes and {@link notify}
     * is called with the new rows. If re-execution fails,
     * {@link reportError} is called with the error.
     */
    async registerReactiveQuery(
        queryId: string,
        sql: string,
        conn: DatabaseClientConnection,
        notify: (rows: ReadonlyArray<Record<string, unknown>>) => void,
        reportError: (error: unknown) => void,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const {rows, readPages} = await this.executeQueryWithTracking(conn, sql);
        this.reactiveQueries.set(queryId, {
            sql,
            readPages,
            conn,
            notify,
            reportError,
            reExecuting: false,
        });
        return rows;
    }

    /**
     * Unregister a reactive query. Stops future
     * invalidation notifications.
     */
    unregisterReactiveQuery(queryId: string): void {
        this.reactiveQueries.delete(queryId);
    }

    private scheduleInvalidation(): void {
        if (this.invalidationScheduled) return;
        this.invalidationScheduled = true;
        queueMicrotask(() => {
            this.invalidationScheduled = false;
            const pages = this.pagesToInvalidate;
            this.pagesToInvalidate = new Set();
            void this.checkInvalidation(pages);
        });
    }

    private async checkInvalidation(writtenPages: ReadonlySet<number>): Promise<void> {
        for (const [, reg] of this.reactiveQueries) {
            if (reg.reExecuting) continue;

            let overlaps = false;
            for (const page of writtenPages) {
                if (reg.readPages.has(page)) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) continue;

            reg.reExecuting = true;
            try {
                const {rows, readPages} = await this.executeQueryWithTracking(reg.conn, reg.sql);
                reg.readPages = readPages;
                reg.notify(rows);
            } catch (error) {
                reg.reportError(error);
            } finally {
                reg.reExecuting = false;
            }
        }
    }

    // -- Page writes ---------------------------------------------------------

    /**
     * Write pages received from realtime events into the
     * local OPFS store, skipping pages that are already at
     * a newer timestamp. If the `mutationId` matches a
     * queued optimistic mutation, removes it from the
     * queue and replays the remaining mutations.
     * Automatically schedules invalidation for any
     * reactive queries whose read-set overlaps the
     * written pages.
     */
    writePagesFromRealtime(
        pages: ReadonlyArray<{pageIndex: number; timestamp: number; data: Uint8Array}>,
        mutationId: DatabaseMutationId,
    ): void {
        const headIndex = this.optimisticQueue.findIndex(m => m.mutationId === mutationId);
        assert(
            headIndex === 0 || headIndex === -1,
            `unexpected mutation confirmation order: ${headIndex}`,
        );

        if (headIndex === 0) {
            this.optimisticQueue.shift();
        }

        this.pageStore.clearOptimisticPages();
        this.applyServerPages(pages);
        this.replayOptimisticQueue();
    }

    private applyServerPages(
        pages: ReadonlyArray<{pageIndex: number; timestamp: number; data: Uint8Array}>,
    ): void {
        let anyWritten = false;
        for (const page of pages) {
            if (this.pageStore.writePageIfNewer(page.pageIndex, page.timestamp, page.data)) {
                this.pagesToInvalidate.add(page.pageIndex);
                anyWritten = true;
            }
        }
        this.pageStore.sync();
        if (anyWritten) {
            this.scheduleInvalidation();
        }
    }

    private removeOptimisticMutation(mutationId: DatabaseMutationId): void {
        this.optimisticQueue = this.optimisticQueue.filter(m => m.mutationId !== mutationId);
        this.pageStore.clearOptimisticPages();
        this.replayOptimisticQueue();
    }

    private replayOptimisticQueue(): void {
        this.optimisticQueue = this.optimisticQueue.filter(mutation => {
            try {
                this.pageStore.optimistic(() => this.executeQueryLocally(mutation.sql));
                return true;
            } catch {
                return false;
            }
        });
    }

    isEmpty(): boolean {
        return this.pageStore.isEmpty();
    }

    private executeQueryLocally(sql: string): ReadonlyArray<Record<string, unknown>> {
        try {
            return this.db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as ReadonlyArray<Record<string, unknown>>;
        } catch (error) {
            const stashed = this.vfs.takeError();
            if (stashed !== null) {
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            throw error;
        }
    }

    private async executeQueryViaServer(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const result = await conn.queryServer(sql);
        this.pageStore.clearOptimisticPages();
        this.applyServerPages(result.pages);
        this.replayOptimisticQueue();
        return result.rows as ReadonlyArray<Record<string, unknown>>;
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }
}
