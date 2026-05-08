/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {
    DatabaseReactiveActionHandle,
    DatabaseReactiveActionResult,
    DatabaseWorkerConnection,
} from "~/client/web/databases/database_active_tab_manager.js";
import {DatabaseClient} from "~/client/web/databases/database_client.js";
import {DatabaseQuery} from "~/client/web/databases/database_query.js";
import type {DatabaseQueryRow} from "~/client/web/databases/database_query_row.js";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {makeDatabaseClientConnection} from "~/client/web/databases/test_helpers/make_database_client_connection.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import type {DatabasePages} from "~/shared/databases/database_protocol_schemas.js";
import {
    databaseMainTableId,
    databaseViewTargetRowsPerPage,
} from "~/shared/databases/sqlite_constants.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {InternalError} from "~/shared/error/error.js";
import {unsafelyConstructChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseRowId} from "~/shared/id/types/id_types.js";
import {ValueStore} from "~/shared/store/value_store.js";

// ---------------------------------------------------------------------------
// Test connection adapter
// ---------------------------------------------------------------------------

/**
 * `DatabaseClientConnection` with a never-resolving
 * server so optimistic pages persist during tests.
 */
const testClientConn = makeDatabaseClientConnection();

/**
 * Creates a {@link DatabaseWorkerConnection} backed by
 * a real {@link DatabaseClient}. Also exposes a
 * `mutate(sql)` shorthand for triggering reactive
 * invalidation via `executeAction("rawSql", ...)`.
 */
function createTestConnection(client: DatabaseClient): {
    conn: DatabaseWorkerConnection;
    mutate: (sql: string) => Promise<void>;
} {
    let watchIdCounter = 0;

    const conn: DatabaseWorkerConnection = {
        call(method, input) {
            if (method === "writeInitialPages") {
                const {pages} = input as unknown as {pages: DatabasePages};
                const mainPages = pages.get(databaseMainTableId);
                if (mainPages != null) {
                    client.seedPages(mainPages);
                }
                return Promise.resolve({} as any);
            }
            throw new InternalError(`Unsupported call method: ${method}`);
        },

        async executeAction<N extends DatabaseActionName>(
            name: N,
            input: DatabaseActionInput<N>,
        ): Promise<DatabaseActionOutput<N>> {
            return client.executeAction(testClientConn, {name, input} as DatabaseActionObject<N>);
        },

        async watchAction<N extends DatabaseActionName>(
            name: N,
            input: DatabaseActionInput<N>,
        ): Promise<DatabaseReactiveActionHandle<N>> {
            const id = `test-watch-${watchIdCounter++}`;
            const store = new ValueStore<DatabaseReactiveActionResult<N>>({
                ok: true,
                value: {} as DatabaseActionOutput<N>,
            });

            const result = await client.registerReactiveAction(
                id,
                {name, input} as DatabaseActionObject<N>,
                testClientConn,
                output => {
                    store.set({ok: true, value: output});
                },
                error => {
                    const message = error instanceof Error ? error.message : String(error);
                    store.set({ok: false, error: message});
                },
            );

            if (result.ok) {
                store.set({ok: true, value: result.value});
            } else {
                const message =
                    result.error instanceof Error ? result.error.message : String(result.error);
                store.set({ok: false, error: message});
            }

            return {
                store,
                unwatch() {
                    client.unregisterReactiveAction(id);
                },
            };
        },

        close() {},
    };

    return {
        conn,
        async mutate(sql: string) {
            await client.executeAction(testClientConn, {name: "rawSql", input: {sql}});
        },
    };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 50));
}

async function setupTestDatabase(): Promise<{
    client: DatabaseClient;
    conn: DatabaseWorkerConnection;
    viewId: string;
    tableName: string;
    mutate: (sql: string) => Promise<void>;
}> {
    const dir = createInMemoryOpfsDirectoryHandle();
    const client = await DatabaseClient.create(dir);

    // Run Alpine schema migrations (creates _alpine_tables etc.)
    client.executeLocallyForTests(runSqliteMigrations);

    const {conn, mutate} = createTestConnection(client);

    // Create a table with full Alpine metadata
    const result = await conn.executeAction("createTable", {name: "Tasks"});

    return {
        client,
        conn,
        viewId: result.viewId,
        tableName: result.tableName,
        mutate,
    };
}

async function insertRows(
    conn: DatabaseWorkerConnection,
    tableName: string,
    n: number,
): Promise<void> {
    const values = Array.from({length: n}, (_, i) => `('Task ${i}')`).join(", ");
    await conn.executeAction("rawSql", {sql: `INSERT INTO ${tableName} (name) VALUES ${values}`});
}

function getTreeItemCount(query: DatabaseQuery): number {
    return query.treeStore.getSnapshot().getItemCount();
}

function getTreeItems(query: DatabaseQuery): ReadonlyArray<DatabaseQueryRow> {
    const tree = query.treeStore.getSnapshot();
    const count = tree.getItemCount();
    const items: Array<DatabaseQueryRow> = [];
    for (let i = 0; i < count; i++) {
        items.push(tree.getItem(i));
    }
    return items;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabaseQuery constructor", () => {
    test("with initialPage populates tree and sets needsMore", () => {
        const fieldIndexes = new Map<DatabaseFieldId, number>([["f1" as DatabaseFieldId, 1]]);
        const query = new DatabaseQuery({
            tableOrViewId: "view-1",
            initialPage: {
                endCursor: "row-100" as DatabaseRowId,
                fieldIndexes,
                rows: [
                    ["row-1", "Task 1"],
                    ["row-2", "Task 2"],
                ],
            },
        });

        expect(getTreeItemCount(query)).toBe(2);
        expect(query.needsMoreStore.getSnapshot()).toBe(true);
        expect(query.isLoadingMoreStore.getSnapshot()).toBe(false);
    });

    test("without initialPage has empty tree", () => {
        const query = new DatabaseQuery({tableOrViewId: "view-1"});

        expect(getTreeItemCount(query)).toBe(0);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);
    });

    test("with empty rows has empty tree", () => {
        const query = new DatabaseQuery({
            tableOrViewId: "view-1",
            initialPage: {
                endCursor: null,
                fieldIndexes: new Map<DatabaseFieldId, number>(),
                rows: [],
            },
        });

        expect(getTreeItemCount(query)).toBe(0);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);
    });

    test("initialPage with null endCursor sets needsMore false", () => {
        const fieldIndexes = new Map<DatabaseFieldId, number>([["f1" as DatabaseFieldId, 1]]);
        const query = new DatabaseQuery({
            tableOrViewId: "view-1",
            initialPage: {
                endCursor: null,
                fieldIndexes,
                rows: [["row-1", "A"]],
            },
        });

        expect(getTreeItemCount(query)).toBe(1);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);
    });
});

describe("DatabaseQuery loadInitialPage", () => {
    test("populates tree from database", async () => {
        const {conn, viewId, tableName} = await setupTestDatabase();
        await insertRows(conn, tableName, 5);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(5);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        query.dispose();
    });

    test("empty table produces empty tree", async () => {
        const {conn, viewId} = await setupTestDatabase();

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(0);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        query.dispose();
    });

    test("is no-op when pages already exist", async () => {
        const {conn, viewId, tableName} = await setupTestDatabase();
        await insertRows(conn, tableName, 3);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        const countBefore = getTreeItemCount(query);

        // Second call should be a no-op
        await query.loadInitialPage();
        expect(getTreeItemCount(query)).toBe(countBefore);

        query.dispose();
    });
});

describe("DatabaseQuery loadMore", () => {
    test("loads additional pages when needsMore is true", async () => {
        const {conn, viewId, tableName} = await setupTestDatabase();
        const totalRows = databaseViewTargetRowsPerPage + 10;
        await insertRows(conn, tableName, totalRows);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(databaseViewTargetRowsPerPage);
        expect(query.needsMoreStore.getSnapshot()).toBe(true);

        await query.loadMore();

        expect(getTreeItemCount(query)).toBe(totalRows);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        query.dispose();
    });

    test("is no-op when needsMore is false", async () => {
        const {conn, viewId, tableName} = await setupTestDatabase();
        await insertRows(conn, tableName, 5);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        const countBefore = getTreeItemCount(query);
        await query.loadMore();
        expect(getTreeItemCount(query)).toBe(countBefore);

        query.dispose();
    });
});

describe("DatabaseQuery reactive updates", () => {
    test("reflects inserted rows", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();
        await insertRows(conn, tableName, 3);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(3);

        await mutate(`INSERT INTO ${tableName} (name) VALUES ('New task')`);
        await flush();

        expect(getTreeItemCount(query)).toBe(4);

        query.dispose();
    });

    test("reflects deleted rows", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();
        await insertRows(conn, tableName, 5);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(5);

        // Get a row ID to delete
        const items = getTreeItems(query);
        const targetId = items[0]!.getId();

        await mutate(`DELETE FROM ${tableName} WHERE _id = '${targetId}'`);
        await flush();

        expect(getTreeItemCount(query)).toBe(4);

        query.dispose();
    });

    test("handles all rows deleted to empty", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();
        await insertRows(conn, tableName, 2);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(2);

        await mutate(`DELETE FROM ${tableName}`);
        await flush();

        expect(getTreeItemCount(query)).toBe(0);
        // Node stays with 0 items — the watch keeps the
        // cursor range covered for future inserts.
        expect(query.treeStore.getSnapshot().getNodeCount()).toBe(1);

        query.dispose();
    });

    test("open-ended page recovers after all rows deleted", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();
        await insertRowsWithIds(mutate, tableName, [100, 200, 300]);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(3);
        // 3 < target → endCursor=null → open-ended
        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        await deleteRowsWithIds(mutate, tableName, [100, 200, 300]);
        await flush();

        expect(getTreeItemCount(query)).toBe(0);

        // Insert new rows — watch is still alive so they
        // appear via the existing subscription.
        await insertRowsWithIds(mutate, tableName, [400, 500]);
        await flush();

        expect(getTreeItemCount(query)).toBe(2);

        query.dispose();
    });

    test("bounded page goes empty then rebalances with neighbor", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // 20 rows → page 1 bounded (10 rows), page 2
        const times = Array.from({length: 20}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, times);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();
        await query.loadMore();
        await flush();

        expect(getTreeNodeCount(query)).toBe(2);
        expect(getTreeItemCount(query)).toBe(20);

        // Delete all 10 rows in page 1 (times 100..1000).
        // Page 1 is bounded — its cursor range should stay
        // covered so rebalance can merge it with page 2.
        const page1Times = Array.from({length: 10}, (_, i) => (i + 1) * 100);
        await deleteRowsWithIds(mutate, tableName, page1Times);
        await flushWithRebalance();

        // Rebalance merges the empty page with page 2
        // into a single page.
        expect(getTreeNodeCount(query)).toBe(1);
        expect(getTreeItemCount(query)).toBe(10);

        // Rows still ordered
        const items = getTreeItems(query);
        const ids = items.map(r => r.getId());
        expect(ids).toEqual([...ids].sort());

        query.dispose();
    });

    test("rows inserted into emptied bounded page range appear", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // 20 rows → page 1 bounded (10 rows), page 2
        const times = Array.from({length: 20}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, times);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();
        await query.loadMore();
        await flush();

        expect(getTreeNodeCount(query)).toBe(2);

        // Delete all rows from page 1
        const page1Times = Array.from({length: 10}, (_, i) => (i + 1) * 100);
        await deleteRowsWithIds(mutate, tableName, page1Times);
        await flush();

        // Insert new rows within page 1's cursor range.
        // These should appear because the watch still
        // covers that range.
        await insertRowsWithIds(mutate, tableName, [150, 250]);
        await flush();

        expect(getTreeItemCount(query)).toBe(12);

        query.dispose();
    });
});

describe("DatabaseQuery dispose", () => {
    test("retains last tree value and resets isLoadingMore", async () => {
        const {conn, viewId, tableName} = await setupTestDatabase();
        await insertRows(conn, tableName, 5);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        const countBeforeDispose = getTreeItemCount(query);
        expect(countBeforeDispose).toBe(5);

        query.dispose();

        // Tree retains its last value
        expect(getTreeItemCount(query)).toBe(countBeforeDispose);
        expect(query.isLoadingMoreStore.getSnapshot()).toBe(false);
    });

    test("loadMore is no-op after dispose", async () => {
        const {conn, viewId, tableName} = await setupTestDatabase();
        await insertRows(conn, tableName, 5);

        const query = new DatabaseQuery({tableOrViewId: viewId});
        query.listen({conn});
        await query.loadInitialPage();

        query.dispose();

        const countBefore = getTreeItemCount(query);
        await query.loadMore();
        expect(getTreeItemCount(query)).toBe(countBefore);
    });
});

// ---------------------------------------------------------------------------
// Rebalance helpers
// ---------------------------------------------------------------------------

const zeroBytes = new Uint8Array(10);

function makeId(time: number): DatabaseRowId {
    return unsafelyConstructChronologicalId<DatabaseRowId>(time, zeroBytes);
}

async function insertRowsWithIds(
    mutate: (sql: string) => Promise<void>,
    tableName: string,
    times: ReadonlyArray<number>,
): Promise<void> {
    if (times.length === 0) return;
    const values = times.map(t => `('${makeId(t)}', 'Row ${t}')`).join(", ");
    await mutate(`INSERT INTO ${tableName} (_id, name) VALUES ${values}`);
}

async function deleteRowsWithIds(
    mutate: (sql: string) => Promise<void>,
    tableName: string,
    times: ReadonlyArray<number>,
): Promise<void> {
    if (times.length === 0) return;
    const ids = times.map(t => `'${makeId(t)}'`).join(", ");
    await mutate(`DELETE FROM ${tableName} WHERE _id IN (${ids})`);
}

/**
 * Flush long enough for reactive updates, rebalance
 * scheduling (setTimeout 0), and the rebalance's own
 * async watch creation to all complete.
 */
async function flushWithRebalance(): Promise<void> {
    await flush();
    await flush();
    await flush();
}

function getTreeNodeCount(query: DatabaseQuery): number {
    return query.treeStore.getSnapshot().getNodeCount();
}

// ---------------------------------------------------------------------------
// Rebalance tests
// ---------------------------------------------------------------------------

describe("DatabaseQuery rebalance — split", () => {
    // target=10, split>=15, merge<=5

    test("page exceeding 1.5x target splits into two pages", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // Insert 10 rows — exactly the target
        const initialTimes = Array.from({length: 10}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, initialTimes);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(10);
        // endCursor is set (10 rows = limit) → needsMore
        expect(query.needsMoreStore.getSnapshot()).toBe(true);

        // Insert 5 rows within the page's cursor range
        // (times < 1000 so _id < endCursor)
        const extraTimes = [150, 250, 350, 450, 550];
        await insertRowsWithIds(mutate, tableName, extraTimes);
        await flushWithRebalance();

        // Should have split into 2 tree nodes
        expect(getTreeNodeCount(query)).toBe(2);
        expect(getTreeItemCount(query)).toBe(15);

        // All rows present in correct order
        const items = getTreeItems(query);
        const ids = items.map(r => r.getId());
        const sorted = [...ids].sort();
        expect(ids).toEqual(sorted);

        query.dispose();
    });

    test("split of last page keeps second half open-ended", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // Insert 3 rows — fewer than target → endCursor=null
        await insertRowsWithIds(mutate, tableName, [100, 200, 300]);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();

        expect(getTreeItemCount(query)).toBe(3);
        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        // Insert 12 more rows → total 15, page is open-ended
        const moreTimes = Array.from({length: 12}, (_, i) => 400 + i * 100);
        await insertRowsWithIds(mutate, tableName, moreTimes);
        await flushWithRebalance();

        expect(getTreeNodeCount(query)).toBe(2);
        expect(getTreeItemCount(query)).toBe(15);

        // The last page should still be open-ended →
        // needsMore stays false.
        expect(query.needsMoreStore.getSnapshot()).toBe(false);

        query.dispose();
    });
});

describe("DatabaseQuery rebalance — merge", () => {
    test("two consecutive small pages merge into one", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // 20 rows → 2 pages of 10
        const times = Array.from({length: 20}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, times);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();
        await query.loadMore();
        await flush();

        expect(getTreeNodeCount(query)).toBe(2);
        expect(getTreeItemCount(query)).toBe(20);

        // Delete 7 from each page → 3 + 3 = 6 total
        // Page 1: IDs with times 100-1000, delete times
        // 100-700
        // Page 2: IDs with times 1100-2000, delete times
        // 1100-1700
        const deleteTimes = [
            100, 200, 300, 400, 500, 600, 700, 1100, 1200, 1300, 1400, 1500, 1600, 1700,
        ];
        await deleteRowsWithIds(mutate, tableName, deleteTimes);
        await flushWithRebalance();

        // 6 total rows → ceil(6/10) = 1 page
        expect(getTreeNodeCount(query)).toBe(1);
        expect(getTreeItemCount(query)).toBe(6);

        // Rows in order
        const items = getTreeItems(query);
        const ids = items.map(r => r.getId());
        expect(ids).toEqual([...ids].sort());

        query.dispose();
    });

    test("single page below threshold does not merge", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // 3 rows → one page with endCursor=null
        await insertRowsWithIds(mutate, tableName, [100, 200, 300]);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();
        await flushWithRebalance();

        // Still 1 page, 3 items — no merge
        expect(getTreeNodeCount(query)).toBe(1);
        expect(getTreeItemCount(query)).toBe(3);

        query.dispose();
    });
});

describe("DatabaseQuery rebalance — merge forward", () => {
    test("small first page merges with next page", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // 20 rows → 2 pages of 10
        const times = Array.from({length: 20}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, times);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();
        await query.loadMore();
        await flush();

        expect(getTreeNodeCount(query)).toBe(2);

        // Delete 7 from page 1 → 3 + 10.
        // Page 1 is small, consumes page 2 → 13 total → 1 page.
        await deleteRowsWithIds(mutate, tableName, [100, 200, 300, 400, 500, 600, 700]);
        await flushWithRebalance();

        expect(getTreeNodeCount(query)).toBe(1);
        expect(getTreeItemCount(query)).toBe(13);

        // All rows in order
        const items = getTreeItems(query);
        const ids = items.map(r => r.getId());
        expect(ids).toEqual([...ids].sort());

        query.dispose();
    });
});

describe("DatabaseQuery rebalance — edge cases", () => {
    test("dispose during rebalance cleans up without error", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        await insertRowsWithIds(
            mutate,
            tableName,
            Array.from({length: 3}, (_, i) => (i + 1) * 100),
        );

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();

        // Add enough rows to trigger split (15 total)
        const moreTimes = Array.from({length: 12}, (_, i) => 400 + i * 100);
        await insertRowsWithIds(mutate, tableName, moreTimes);
        await flush();

        // Dispose immediately — rebalance timer may be
        // pending or in-flight.
        query.dispose();

        // No crash, tree retains its last value
        expect(getTreeItemCount(query)).toBeGreaterThan(0);
    });

    test("loadMore blocked during rebalance", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        const times = Array.from({length: 20}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, times);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();
        await query.loadMore();
        await flush();

        // Delete from page 2 to trigger rebalance
        await deleteRowsWithIds(mutate, tableName, [1100, 1200, 1300, 1400, 1500, 1600]);
        // Don't wait for rebalance — try loadMore immediately
        await flush();

        // loadMore should be blocked (no-op) and should
        // not throw.
        await query.loadMore();
        await flushWithRebalance();

        // After rebalance completes, data is still
        // consistent.
        expect(getTreeItemCount(query)).toBe(14);

        query.dispose();
    });

    test("reactive update after split lands in correct page", async () => {
        const {conn, viewId, tableName, mutate} = await setupTestDatabase();

        // 10 rows → 1 bounded page
        const initialTimes = Array.from({length: 10}, (_, i) => (i + 1) * 100);
        await insertRowsWithIds(mutate, tableName, initialTimes);

        const query = new DatabaseQuery({
            tableOrViewId: viewId,
            _targetRowsPerPage: 10,
        });
        query.listen({conn});
        await query.loadInitialPage();

        // Insert 5 within range → 15 → split
        await insertRowsWithIds(mutate, tableName, [150, 250, 350, 450, 550]);
        await flushWithRebalance();

        expect(getTreeNodeCount(query)).toBe(2);
        expect(getTreeItemCount(query)).toBe(15);

        // Insert one more row within the first page's
        // range
        await insertRowsWithIds(mutate, tableName, [120]);
        await flush();

        expect(getTreeItemCount(query)).toBe(16);

        // All rows still in order
        const items = getTreeItems(query);
        const ids = items.map(r => r.getId());
        expect(ids).toEqual([...ids].sort());

        query.dispose();
    });
});
