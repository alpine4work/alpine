import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseConnectionManager,
    type DatabaseConnectionManagerSocket,
    type DatabaseConnectionManagerTabConnection,
} from "~/client/web/databases/worker/database_connection_manager.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {DatabaseGroupDurableObject} from "~/server/databases/database_durable_object.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
    DatabaseActionResult,
} from "~/shared/databases/database_actions.js";
import type {DatabasePages} from "~/shared/databases/database_protocol_schemas.js";
import {sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {
    BrowserId,
    DatabaseFieldId,
    DatabaseGroupId,
    DatabaseReactiveActionId,
    DatabaseRowId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.js";

type DatabaseSqlStorage = ConstructorParameters<typeof DatabaseDurableObjectStorage>[0];

const context = createTestWorkerContext();
const durableObjectSqlStorages = new Map<string, DatabaseSqlStorage>();
const durableObjectTest = DatabaseGroupDurableObject.test(context, {
    createStorageForTest: idName => {
        const storage = new DurableObjectStorage(new MemoryStorage());
        durableObjectSqlStorages.set(idName, (storage as unknown as {sql: DatabaseSqlStorage}).sql);
        return storage;
    },
});

type DatabaseServerConnection = Awaited<ReturnType<typeof durableObjectTest.connectForTest>>;

// ---------------------------------------------------------------------------
// Basic round trips
// ---
//
// ---

test("client executes actions against the database server", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const client = await createTestClient(databaseGroupId);

    const createTableResult = await executeAction(client, "createTable", {name: "Projects"});
    const tableRowsResult = await executeAction(client, "readonlyRawSql", {
        sql: `
            SELECT
                id,
                kind
            FROM
                _alpine_tables
        `,
    });

    expect({rows: tableRowsResult.rows, reportedErrors: client.reportedErrors}).toEqual({
        rows: [
            {
                id: createTableResult.tableId,
                kind: "table",
            },
        ],
        reportedErrors: [],
    });
});

// Guards the ATTACH ordering in `executeActionViaServer`: the new table's pages
// are applied to the local store _before_ the per-db file is attached. Attaching
// first would make SQLite parse — and, under `locking_mode = EXCLUSIVE`,
// permanently cache — an empty schema, failing every later local reference to the
// table with "no such table".
test("a client can immediately use a table it just created", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const client = await createTestClient(databaseGroupId);

    const table = await executeAction(client, "createTable", {name: "Projects"});
    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(client, "createRow", {tableId: table.tableId, rowId});
    await settle();

    expect({
        rowIds: await selectRowIds(client, table),
        reportedErrors: client.reportedErrors,
    }).toEqual({
        rowIds: [rowId],
        reportedErrors: [],
    });
});

// The reader-side counterpart of the ATTACH-ordering guard above: the first read
// of an unknown table falls back to the server, whose response must carry enough
// to attach the table from cache (its pages, always including page 0, plus the
// canonical file size — a sparse cache serving a header-derived size reads as
// corrupt). Every subsequent read is then served locally.
test("a client keeps reading a table it first fetched from the server", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const reader = await createTestClient(databaseGroupId);

    const firstRead = await selectRowIds(reader, table);
    const secondRead = await selectRowIds(reader, table);

    expect({
        firstRead,
        secondRead,
        executeActionCalls: reader.executeActionCalls,
    }).toEqual({
        firstRead: [],
        secondRead: [],
        // Only the first read hit the server; the second was served locally.
        executeActionCalls: [{name: "readonlyRawSql", returnResult: true}],
    });
});

test("a warmed client executes an optimistic mutation confirmed over realtime", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const client = await createWarmClient(databaseGroupId, table);

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(client, "createRow", {tableId: table.tableId, rowId});
    await settle();

    expect({
        rowIds: await selectRowIds(client, table),
        reportedErrors: client.reportedErrors,
        // The mutation ran optimistically: the only server call is the fire-and-forget
        // background send, not a foreground fallback.
        executeActionCalls: client.executeActionCalls,
    }).toEqual({
        rowIds: [rowId],
        reportedErrors: [],
        executeActionCalls: [{name: "createRow", returnResult: false}],
    });
});

test("a fresh client reads another client\u2019s table through the server fallback", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    // A brand-new browser holds none of the table's pages, so its first read routes to
    // the server and returns the canonical rows.
    const reader = await createTestClient(databaseGroupId);
    const rowIds = await selectRowIds(reader, table);

    expect(rowIds).toEqual([rowId]);
});

test("realtime page diffs keep a warmed client\u2019s local reads fresh", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    // The reader saw the write via the realtime page diff alone — its read is served
    // from the local cache without any server call.
    expect({
        rowIds: await selectRowIds(reader, table),
        executeActionCalls: reader.executeActionCalls,
    }).toEqual({
        rowIds: [rowId],
        executeActionCalls: [],
    });
});

// Every page diff carries the version of the base it was computed against
// (`previousVersion`); a diff whose base the client never saw — here because the
// event carrying it was missed while disconnected — must not be applied on top of
// the stale cached page (that would merge two page states into one that never
// existed on the server). The client drops the page instead and re-fetches it from
// the server on the next read.
test("a page diff computed against a missed update is dropped and re-fetched, not applied", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);

    const rowId1 = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId: rowId1});
    await settle();

    // The reader misses the diff for row 2, then applies the diff for row 3 — computed
    // against a base page containing rows 1 and 2 — onto its stale base containing
    // only row 1.
    reader.goOffline();
    const rowId2 = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId: rowId2});
    await settle();
    reader.goOnline();
    const rowId3 = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId: rowId3});
    await settle();

    expect(await selectRowIds(reader, table)).toEqual(await selectRowIds(writer, table));
});

// Realtime events broadcast while the socket is down are gone for good, so on
// reconnect the manager revalidates the whole cache (`ensureCacheIsUpToDate` runs
// again) before local reads can be trusted — without it, reads would serve the
// pre-disconnect state indefinitely.
test("a client that missed realtime events while disconnected serves fresh reads after reconnecting", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);

    reader.goOffline();
    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();
    reader.goOnline();
    await settle();

    expect(await selectRowIds(reader, table)).toEqual([rowId]);
});

// A schema change (`createField` runs `ALTER TABLE ... ADD COLUMN` on the per-db
// file) reaches a peer whose SQLite connection already has the table attached: the
// realtime diff rewrites the file's sqlite_schema pages and bumps the schema
// cookie, and the peer's next prepare re-reads the schema instead of serving its
// stale parsed copy. This guards the populated-table counterpart of the
// empty-at-attach staleness covered in the "known desync issues" tests below:
// under `locking_mode = EXCLUSIVE` only a table attached while its local store was
// empty gets stuck on a stale schema; a table attached with pages present must
// keep tracking schema changes.
test("a schema change from another client is visible to an attached peer", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    const fieldId = generateChronologicalId<DatabaseFieldId>();
    await executeAction(writer, "createField", {
        fieldId,
        tableId: table.tableId,
        name: "Notes",
        config: {type: "plainText"},
    });
    await executeAction(writer, "updateCellValue", {
        tableId: table.tableId,
        fieldId,
        rowId,
        value: "hello",
    });
    await settle();

    // Read the new column through the reader's SQLite connection. A stale parsed
    // schema fails the prepare with "no such column" rather than falling back to the
    // server (only missing pages trigger the fallback).
    const {fields} = await executeAction(writer, "getViewSchema", {
        tableOrViewId: table.tableId,
    });
    const columnName = fields.find(field => field.id === fieldId)!.columnName;
    const {rows} = await executeAction(reader, "readonlyRawSql", {
        sql: sql`
            SELECT
                _id,
                ${sql.identifier(columnName)} AS value
            FROM
                ${sql.tableRef(table.tableId, table.tableName)}
        `.query,
    });

    expect({rows, executeActionCalls: reader.executeActionCalls}).toEqual({
        rows: [{_id: rowId, value: "hello"}],
        executeActionCalls: [],
    });
});

test("a reactive action re-notifies when another client writes", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const watcher = await createWarmClient(databaseGroupId, table);

    await watcher.manager.registerReactiveAction(
        {
            databaseGroupId,
            id: generateId<DatabaseReactiveActionId>(),
            action: {
                name: "readonlyRawSql",
                input: {sql: selectRowIdsQuery(table)},
            },
        },
        watcher.tabConnection,
    );

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    expect(watcher.reactiveUpdates).toEqual([
        {name: "readonlyRawSql", output: {rows: [{_id: rowId}]}},
    ]);
});

test("server-side action errors reject the caller", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const client = await createTestClient(databaseGroupId);

    // createRelationField calls ctx.server(), which throws on the client and routes
    // the action to the server; referencing a table that doesn't exist makes the
    // server throw, and the error surfaces to the calling client.
    await expect(
        executeAction(client, "createRelationField", {
            joinTableId: generateChronologicalId<DatabaseTableId>(),
            sourceTableId: generateChronologicalId<DatabaseTableId>(),
            sourceFieldName: "Link",
            targetTableId: generateChronologicalId<DatabaseTableId>(),
            cardinality: "many",
        }),
    ).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// Concurrent writers
// ---
//
// ---

test("concurrent conflicting inserts converge with the loser reporting the constraint error", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const clientA = await createWarmClient(databaseGroupId, table);
    const clientB = await createWarmClient(databaseGroupId, table);

    // Both clients optimistically insert the same row id before either learns of the
    // other's write. The server accepts A's insert; B's replay and server execution
    // both hit the primary-key constraint.
    const rowId = generateChronologicalId<DatabaseRowId>();
    const insertA = executeAction(clientA, "createRow", {tableId: table.tableId, rowId});
    const insertB = executeAction(clientB, "createRow", {tableId: table.tableId, rowId});
    await insertA;
    await insertB;
    await settle();

    expect({
        rowIdsA: await selectRowIds(clientA, table),
        rowIdsB: await selectRowIds(clientB, table),
        reportedErrorsA: clientA.reportedErrors,
        reportedErrorsB: clientB.reportedErrors,
    }).toEqual({
        rowIdsA: [rowId],
        rowIdsB: [rowId],
        reportedErrorsA: [],
        reportedErrorsB: [expect.stringContaining("UNIQUE constraint failed")],
    });
});

// When two clients race conflicting mutations, the loser's mutation can become a
// no-op on the server (e.g. deleting an already-deleted row) that writes no pages
// and so broadcasts no `PagesChanged` event. The server still confirms the
// mutation to its originator with an empty event, so the loser's optimistic queue
// drains without a spurious "mutation not confirmed" error and both sides converge
// cleanly.
test("a mutation that no-ops on the server is confirmed without errors", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const clientA = await createWarmClient(databaseGroupId, table);
    const clientB = await createWarmClient(databaseGroupId, table);

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(clientA, "createRow", {tableId: table.tableId, rowId});
    await settle();

    // Both clients optimistically delete the table's only row before either learns of
    // the other's delete. The second delete to reach the server matches no rows. The
    // subquery targets the row without a bound parameter (`.query` drops bindings) and
    // keeps SQLite off the truncate-optimized DELETE path, which bypasses page writes
    // entirely.
    const tableRef = sql.tableRef(table.tableId, table.tableName);
    const deleteSql = sql`
        DELETE FROM ${tableRef}
        WHERE
            _id IN (
                SELECT
                    MIN(_id)
                FROM
                    ${tableRef}
            )
    `.query;
    const deleteA = executeAction(clientA, "rawSql", {sql: deleteSql});
    const deleteB = executeAction(clientB, "rawSql", {sql: deleteSql});
    await deleteA;
    await deleteB;
    await settle();

    expect({
        rowIdsA: await selectRowIds(clientA, table),
        rowIdsB: await selectRowIds(clientB, table),
        reportedErrorsA: clientA.reportedErrors,
        reportedErrorsB: clientB.reportedErrors,
    }).toEqual({
        rowIdsA: [],
        rowIdsB: [],
        reportedErrorsA: [],
        reportedErrorsB: [],
    });
});

// ---------------------------------------------------------------------------
// Restart recovery
// ---
//
// ---

test("a restarted client revalidates the main registry at cold open", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const stale = await createWarmClient(databaseGroupId, table);
    stale.close();

    // While the browser is gone, another client registers a second table (a main
    // registry change).
    const other = await createTestClient(databaseGroupId);
    const secondTable = await executeAction(other, "createTable", {name: "Tasks"});
    await settle();

    // On restart, `ensureCacheIsUpToDate` refreshes the stale main pages, so the
    // registry read is served locally with fresh data.
    const restarted = await restartClient(stale, databaseGroupId);
    const {tableIds} = await executeAction(restarted, "listTableIds", {});

    expect([...tableIds].sort()).toEqual([table.tableId, secondTable.tableId].sort());
});

// Guards the store-enumeration at cold open: `DatabaseClient.create` opens a page
// store for every table cached in the group's OPFS directory, so
// `ensureCacheIsUpToDate` validates all of them — not just the tables named in the
// loader's seed pages — and attaches them with fresh data.
test("a restarted client revalidates cached per-table files at cold open", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const stale = await createWarmClient(databaseGroupId, table);
    stale.close();

    // While the browser is gone, another client adds a row (a per-table file change,
    // invisible to a validation that only covered the main table).
    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    const restarted = await restartClient(stale, databaseGroupId);

    expect(await selectRowIds(restarted, table)).toEqual([rowId]);
});

// ---------------------------------------------------------------------------
// Test client harness
// ---
//
// ---

interface TestDatabaseClientExecuteActionCall {
    readonly name: DatabaseActionName;
    readonly returnResult: boolean;
}

interface TestDatabaseClient {
    readonly manager: DatabaseConnectionManager;
    readonly tabConnection: DatabaseConnectionManagerTabConnection;
    readonly reportedErrors: Array<string>;
    readonly reactiveUpdates: Array<DatabaseActionResult>;
    /**
     * Every `executeAction` procedure call this client sent to the server. Optimistic
     * background confirmations carry `returnResult: false`; foreground fallbacks carry
     * `returnResult: true`.
     */
    readonly executeActionCalls: Array<TestDatabaseClientExecuteActionCall>;
    readonly dir: OpfsDirectoryHandle;
    readonly browserId: BrowserId;
    readonly databaseGroupId: DatabaseGroupId;
    /**
     * Drop the socket: realtime events stop being delivered and the connection state
     * flips to disconnected.
     */
    goOffline(): void;
    /**
     * Reconnect the socket: events resume and the connection state flips back to
     * connected (events broadcast while offline stay lost, as in production).
     */
    goOnline(): void;
    /** Close the server connection, as if the browser went away. */
    close(): void;
}

interface TestDatabaseTableRef {
    readonly tableId: DatabaseTableId;
    readonly tableName: string;
}

interface TestDatabaseTable extends TestDatabaseTableRef {
    /**
     * A full page snapshot of the group (main + the table's per-db file) taken right
     * after the table was created, for seeding warm clients the way the SSR loader
     * does in production.
     */
    readonly seedPages: DatabasePages;
}

/**
 * Wires a real {@link DatabaseConnectionManager} to the real durable object
 * server, standing in for one browser. Each client gets its own OPFS directory and
 * `browserId` unless overridden (pass both to model a restart of the same browser
 * — see {@link restartClient}). `pages` seeds the OPFS cache through
 * `connectDatabaseGroup`, mirroring the loader-provided pages a production tab
 * passes on startup.
 */
async function createTestClient(
    databaseGroupId: DatabaseGroupId,
    options: {browserId?: BrowserId; dir?: OpfsDirectoryHandle; pages?: DatabasePages} = {},
): Promise<TestDatabaseClient> {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const browserId = options.browserId ?? generateId<BrowserId>();
    const dir = options.dir ?? createInMemoryOpfsDirectoryHandle();
    const serverConnection = await durableObjectTest.connectForTest(
        context.action(session),
        databaseGroupId,
        {searchParams: new URLSearchParams([["browserId", browserId]])},
    );

    let online = true;
    const stateListeners = new Set<() => void>();
    const setOnline = (next: boolean) => {
        if (online === next) return;
        online = next;
        for (const listener of stateListeners) {
            listener();
        }
    };
    const executeActionCalls: Array<TestDatabaseClientExecuteActionCall> = [];
    const reportedErrors: Array<string> = [];
    const reactiveUpdates: Array<DatabaseActionResult> = [];
    const tabConnection: DatabaseConnectionManagerTabConnection = {
        reactiveActionUpdated: async ({result}) => {
            reactiveUpdates.push(result);
        },
        reactiveActionError: async () => {},
        reportError: async ({message}) => {
            reportedErrors.push(message);
        },
    };
    const manager = new DatabaseConnectionManager(dir, () => [tabConnection], {
        createSocket: () =>
            createSocketForServerConnection(serverConnection, {
                isOnline: () => online,
                stateListeners,
                executeActionCalls,
            }),
    });
    manager.connectDatabaseGroup({
        databaseGroupId,
        pages: options.pages ?? new Map(),
        webSocketUrl: "ws://test.invalid",
    });

    return {
        manager,
        tabConnection,
        reportedErrors,
        reactiveUpdates,
        executeActionCalls,
        dir,
        browserId,
        databaseGroupId,
        goOffline: () => {
            setOnline(false);
        },
        goOnline: () => {
            setOnline(true);
        },
        close: () => {
            serverConnection.close();
        },
    };
}

/**
 * Model a browser restart: close the client's server connection and stand up a
 * fresh manager (fresh SQLite connection, fresh cold-open cache validation) on the
 * same OPFS directory and `browserId`.
 */
async function restartClient(
    client: TestDatabaseClient,
    databaseGroupId: DatabaseGroupId,
): Promise<TestDatabaseClient> {
    client.close();
    return await createTestClient(databaseGroupId, {
        dir: client.dir,
        browserId: client.browserId,
    });
}

/**
 * Create the group's table via a throwaway client and snapshot the group's pages
 * for seeding warm clients. Server-only actions like `createTable` execute fine,
 * but the creating client itself can't use the table afterwards (see the "known
 * desync issues" tests), so tests that need a usable table pair this with {@link
 * createWarmClient}.
 */
async function createTableOnServer(databaseGroupId: DatabaseGroupId): Promise<TestDatabaseTable> {
    const client = await createTestClient(databaseGroupId);
    const {tableId, tableName} = await executeAction(client, "createTable", {name: "Projects"});
    await settle();
    const seedPages = extractServerPages(databaseGroupId, [databaseMainTableId, tableId]);
    client.close();
    return {tableId, tableName, seedPages};
}

/**
 * Snapshot every page of the given tables straight from the durable object's
 * canonical storage: the complete, versioned page set a fully warmed client holds.
 * Stands in for the loader-provided pages a production tab passes to
 * `connectDatabaseGroup` on startup.
 */
function extractServerPages(
    databaseGroupId: DatabaseGroupId,
    tableIds: ReadonlyArray<DatabaseTableId>,
): DatabasePages {
    const sqlStorage = durableObjectSqlStorages.get(databaseGroupId);
    assert(sqlStorage !== undefined, `no durable object storage for group ${databaseGroupId}`);
    const storage = new DatabaseDurableObjectStorage(sqlStorage);

    const pages = new Map<DatabaseTableId, Map<number, {version: number; data: Uint8Array}>>();
    for (const tableId of tableIds) {
        const tablePages = new Map<number, {version: number; data: Uint8Array}>();
        const fileSizeInPages = storage.getFileSize(tableId) / sqlitePageSize;
        for (let pageIndex = 0; pageIndex < fileSizeInPages; pageIndex++) {
            const page = storage.readPage(tableId, pageIndex);
            if (page !== null) {
                tablePages.set(pageIndex, {version: page.version, data: page.data});
            }
        }
        pages.set(tableId, tablePages);
    }
    return pages;
}

/**
 * Create a client that can read and write `table` fully locally, by seeding its
 * OPFS cache with loader pages the way a production tab starts. Cold-open cache
 * validation brings any stale seeded pages up to date and attaches the table; the
 * trailing read proves the client operates locally (no server calls).
 */
async function createWarmClient(
    databaseGroupId: DatabaseGroupId,
    table: TestDatabaseTable,
): Promise<TestDatabaseClient> {
    const client = await createTestClient(databaseGroupId, {pages: table.seedPages});
    await selectRowIds(client, table);
    assert(
        client.executeActionCalls.length === 0,
        "warm client unexpectedly fell back to the server",
    );
    return client;
}

/**
 * Adapts a durable object test connection into the socket interface {@link
 * DatabaseConnectionManager} expects from its `createSocket` dependency. Both
 * sides expose the same procedures mapped type over `DatabaseRealtimeProtocol`, so
 * calls pass through to the durable object. The test connection is already
 * connected, so `connect()` and `reconnect()` are no-ops.
 *
 * `executeAction` responses are held for one macrotask: over a production
 * WebSocket the server sends the `PagesChanged` event before the procedure
 * response on the same ordered socket, while the test connection delivers events
 * through detached async tasks. The delay preserves the production
 * event-before-response ordering that optimistic confirmation relies on.
 *
 * `isOnline` gates event delivery and drives the reported connection state: while
 * it returns false, realtime events are dropped and the state reads as
 * disconnected — modelling a dropped socket. `stateListeners` fire on each
 * online/offline flip so the manager observes the reconnect transition (and
 * revalidates its cache) the way it would from a real `WebSocketClient`.
 */
function createSocketForServerConnection(
    serverConnection: DatabaseServerConnection,
    options: {
        isOnline: () => boolean;
        stateListeners: Set<() => void>;
        executeActionCalls: Array<TestDatabaseClientExecuteActionCall>;
    },
): DatabaseConnectionManagerSocket {
    return {
        procedures: {
            ...serverConnection.procedures,
            executeAction: async input => {
                options.executeActionCalls.push({
                    name: input.action.name,
                    returnResult: input.returnResult,
                });
                const output = await serverConnection.procedures.executeAction(input);
                await new Promise(resolve => setTimeout(resolve, 0));
                return output;
            },
        },
        state: {
            getSnapshot: () =>
                options.isOnline()
                    ? {
                          hasError: false,
                          isConnecting: false,
                          isConnected: true,
                          isDisconnected: false,
                      }
                    : {
                          hasError: false,
                          isConnecting: false,
                          isConnected: false,
                          isDisconnected: true,
                      },
            subscribe: listener => {
                options.stateListeners.add(listener);
                return () => {
                    options.stateListeners.delete(listener);
                };
            },
        },
        subscribeToEvents: handler =>
            serverConnection.subscribeToEvents(event => {
                if (options.isOnline()) handler(event);
            }),
        connect() {
            // A real `WebSocketClient` notifies state subscribers when the initial connection
            // is established; mirror that so the manager can tell later reconnects apart from
            // this first connect.
            for (const listener of options.stateListeners) {
                listener();
            }
        },
        reconnect() {},
        async disconnect() {
            serverConnection.close();
        },
    };
}

async function executeAction<const Name extends DatabaseActionName>(
    client: TestDatabaseClient,
    name: Name,
    input: DatabaseActionInput<Name>,
): Promise<DatabaseActionOutput<Name>> {
    const {result} = await client.manager.executeAction({
        databaseGroupId: client.databaseGroupId,
        action: {name, input} as DatabaseActionObject,
    });
    return result.output as DatabaseActionOutput<Name>;
}

function selectRowIdsQuery(table: TestDatabaseTableRef): string {
    return sql`
        SELECT
            _id
        FROM
            ${sql.tableRef(table.tableId, table.tableName)}
        ORDER BY
            _id
    `.query;
}

async function selectRowIds(
    client: TestDatabaseClient,
    table: TestDatabaseTableRef,
): Promise<Array<DatabaseRowId>> {
    const {rows} = await executeAction(client, "readonlyRawSql", {
        sql: selectRowIdsQuery(table),
    });
    return (rows as Array<{_id: DatabaseRowId}>).map(row => row._id);
}

/**
 * Let background work settle: optimistic mutation sends, realtime event delivery,
 * and the microtask-scheduled reactive invalidations they trigger.
 */
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}
