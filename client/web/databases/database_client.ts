import type {ExecuteServerResult} from "~/client/web/databases/database_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import type {Database, Sqlite3Static} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {InstalledVfs} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {
    type PageDiff,
    applyPageDiff,
    diffPage,
    shouldIgnorePageInvalidation,
} from "~/shared/databases/page_diff.js";
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

/** Flag passed to `pageAccessHook` for page reads. */
const pageAccessFlagRead = 1;

/**
 * Represents a connected tab's route to the server.
 * Passed into {@link DatabaseClient.execute} so server
 * fallbacks route through the correct tab's WebSocket
 * connection.
 */
export interface DatabaseClientConnection {
    executeServer(
        sql: string,
        options: {allowWrites: boolean; mutationId: DatabaseMutationId},
    ): Promise<ExecuteServerResult>;
    reportError(error: unknown): void;
}

/**
 * Client-side SQLite database backed by OPFS page
 * storage. Handles server fallback transparently:
 * when a local query hits a missing page, calls
 * {@link DatabaseClientConnection.executeServer} to
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
     * Execute SQL. Detects reads vs writes via the
     * optimistic page store: if the local execution
     * writes no pages, it's a read and returns
     * immediately. If pages are written, it's treated
     * as a mutation with optimistic local execution
     * and background server confirmation.
     *
     * Falls back to the server when the local store
     * is empty or missing pages.
     */
    async execute(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const mutationId = generateId<DatabaseMutationId>();

        if (this.isEmpty()) {
            try {
                return await this.executeReadOnlyViaServer(conn, sql);
            } catch {
                // Server unavailable — fall through to local
            }
        }

        let rows!: ReadonlyArray<Record<string, unknown>>;
        let writtenPages: ReadonlySet<number>;
        try {
            writtenPages = this.pageStore.optimistic(() => {
                rows = this.executeLocally(sql);
            });
        } catch (error) {
            if (error instanceof PageMissingError) {
                // Try read-only first so pages get cached
                // locally. Falls back to a write-capable
                // server call if the SQL is a mutation.
                try {
                    return await this.executeReadOnlyViaServer(conn, sql);
                } catch {
                    const result = await conn.executeServer(sql, {
                        allowWrites: true,
                        mutationId,
                    });
                    return result.rows as ReadonlyArray<Record<string, unknown>>;
                }
            }
            throw error;
        }

        if (writtenPages.size === 0) {
            // Pure read — no server round-trip needed.
            return rows;
        }

        this.optimisticQueue.push({mutationId, sql});
        this.invalidateForWrittenPages(writtenPages);

        // Send to server in the background.
        void (async () => {
            try {
                await conn.executeServer(sql, {allowWrites: true, mutationId});
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
     * `executeLocally` calls — never across an
     * `await` — so concurrent tracking calls cannot
     * interfere with each other.
     */
    async executeWithTracking(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<{rows: ReadonlyArray<Record<string, unknown>>; readPages: ReadonlySet<number>}> {
        if (this.isEmpty()) {
            try {
                await this.executeReadOnlyViaServer(conn, sql);
            } catch {
                // Server unavailable — fall through to local
            }
        }

        const readPages = new Set<number>();
        const setHook = () => {
            this.db.pageAccessHook((_pArg, pgno, flags) => {
                if (flags === pageAccessFlagRead) readPages.add(pgno - 1);
            });
        };

        try {
            setHook();
            try {
                return {rows: this.executeLocally(sql), readPages};
            } finally {
                this.db.pageAccessHook(null);
            }
        } catch (error) {
            if (!(error instanceof PageMissingError)) throw error;
            readPages.clear();
            await this.executeReadOnlyViaServer(conn, sql);
            setHook();
            try {
                return {rows: this.executeLocally(sql), readPages};
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
        const {rows, readPages} = await this.executeWithTracking(conn, sql);
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
                const {rows, readPages} = await this.executeWithTracking(reg.conn, reg.sql);
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
        pages: ReadonlyArray<{pageIndex: number; timestamp: number; diff: PageDiff}>,
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

        let anyWritten = false;
        for (const page of pages) {
            const base = this.pageStore.readPage(page.pageIndex);
            if (base === null) continue;
            const full = applyPageDiff(base, page.diff);
            if (this.pageStore.writePageIfNewer(page.pageIndex, page.timestamp, full)) {
                if (!shouldIgnorePageInvalidation(page.pageIndex, page.diff)) {
                    this.pagesToInvalidate.add(page.pageIndex);
                    anyWritten = true;
                }
            }
        }
        this.pageStore.sync();
        if (anyWritten) {
            this.scheduleInvalidation();
        }

        this.replayOptimisticQueue();
    }

    private applyServerPages(
        readPages: ReadonlyMap<number, {timestamp: number; data: Uint8Array}>,
    ): void {
        let anyWritten = false;
        for (const [pageIndex, {timestamp, data}] of readPages) {
            if (this.pageStore.writePageIfNewer(pageIndex, timestamp, data)) {
                this.pagesToInvalidate.add(pageIndex);
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
        let anyInvalidated = false;
        this.optimisticQueue = this.optimisticQueue.filter(mutation => {
            try {
                const writtenPages = this.pageStore.optimistic(() => {
                    this.executeLocally(mutation.sql);
                });
                if (this.markWrittenPages(writtenPages)) {
                    anyInvalidated = true;
                }
                return true;
            } catch {
                return false;
            }
        });
        if (anyInvalidated) {
            this.scheduleInvalidation();
        }
    }

    /**
     * Adds optimistically written pages to
     * {@link pagesToInvalidate}, filtering out noise-only
     * changes on page 0. Returns true if any pages were
     * marked.
     */
    private markWrittenPages(writtenPages: ReadonlySet<number>): boolean {
        let anyMarked = false;
        for (const pageIndex of writtenPages) {
            if (pageIndex === 0) {
                const base = this.pageStore.readPage(0);
                const overlay = this.pageStore.getOptimisticPage(0);
                if (base !== null && overlay !== undefined) {
                    const diff = diffPage(base, overlay);
                    if (shouldIgnorePageInvalidation(0, diff)) continue;
                }
            }
            this.pagesToInvalidate.add(pageIndex);
            anyMarked = true;
        }
        return anyMarked;
    }

    private invalidateForWrittenPages(writtenPages: ReadonlySet<number>): void {
        if (this.markWrittenPages(writtenPages)) {
            this.scheduleInvalidation();
        }
    }

    isEmpty(): boolean {
        return this.pageStore.isEmpty();
    }

    private executeLocally(sql: string): ReadonlyArray<Record<string, unknown>> {
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

    private async executeReadOnlyViaServer(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const mutationId = generateId<DatabaseMutationId>();
        const result = await conn.executeServer(sql, {allowWrites: false, mutationId});
        this.pageStore.clearOptimisticPages();
        this.applyServerPages(result.readPages);
        this.replayOptimisticQueue();
        return result.rows as ReadonlyArray<Record<string, unknown>>;
    }

    /**
     * Execute SQL locally without server interaction.
     * Writes go directly to the base OPFS store (not
     * optimistic pages). Use for test setup only.
     */
    executeLocallyForTests(sql: string): ReadonlyArray<Record<string, unknown>> {
        assert(import.meta.jest, "executeLocallyForTests is test-only");
        return this.executeLocally(sql);
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }
}
