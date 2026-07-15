import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {
    createInMemoryOpfsDirectoryHandle,
    extractOpfsTablePages,
    prepopulateOpfsTablePages,
} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseConnectionManager,
    type DatabaseConnectionManagerSocket,
    type DatabaseConnectionManagerTabConnection,
} from "~/client/web/databases/worker/database_connection_manager.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {
    createDatabaseTableMetadataForTest,
    updateDatabaseTableAccessPolicy,
} from "~/server/databases/data/database_table_metadata.js";
import {DatabaseGroupDurableObject} from "~/server/databases/database_durable_object.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {
    type DatabaseActionInput,
    type DatabaseActionName,
    type DatabaseActionObject,
    DatabaseActionObjectSchema,
    type DatabaseActionOutput,
    type DatabaseActionResult,
} from "~/shared/databases/database_actions.js";
import type {
    DatabasePages,
    DatabaseTableRegistrations,
} from "~/shared/databases/database_protocol_schemas.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {sql} from "~/shared/databases/sql.js";
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {
    AccountId,
    DatabaseFieldId,
    DatabaseGroupId,
    DatabaseReactiveActionId,
    DatabaseRowId,
    DatabaseTableId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

type DatabaseDurableStorage = Parameters<typeof DatabaseServer.create>[0];

const context = createTestWorkerContext();
const durableObjectStorages = new Map<string, DatabaseDurableStorage>();
const testSpacesByDatabaseGroupId = new Map<DatabaseGroupId, TestSpace>();
const durableObjectTest = DatabaseGroupDurableObject.test(context, {
    createStorageForTest: idName => {
        const storage = new DurableObjectStorage(new MemoryStorage());
        durableObjectStorages.set(idName, storage);
        return storage;
    },
});

type DatabaseServerConnection = Awaited<ReturnType<typeof durableObjectTest.connectForTest>>;

function createTableInputForTest(name: string) {
    return {
        tableId: generateChronologicalId<DatabaseTableId>(),
        name,
        // Grant every space member Manage so the test clients — which connect as ordinary
        // sessions and are now subject to per-table access — can read and write these
        // tables. These tests exercise sync mechanics, not access control.
        accessPolicy: {
            ...databaseTableAccessPolicyForCreator(generateId<AccountId>()),
            defaultGrant: {level: "Manage" as const, generation: 0},
        },
    };
}

// ---------------------------------------------------------------------------
// Basic round trips
// ---
//
// ---

test("client executes actions against the database server", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const createTableResult = await executeInternalAction(
        databaseGroupId,
        "createTable",
        createTableInputForTest("Projects"),
    );
    const client = await createTestClient(databaseGroupId);
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

test("a connection from an account outside the group\u2019s space is refused", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    await getOrCreateTestSpaceForDatabaseGroupId(databaseGroupId);
    const otherSpace = await TestSpace.create(context);
    const outsiderSession = await otherSpace.createSession();

    await expect(
        durableObjectTest.connectForTest(context.action(outsiderSession), databaseGroupId),
    ).rejects.toThrow();
});

test("the HTTP action route rejects browser-issued tokens", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await getOrCreateTestSpaceForDatabaseGroupId(databaseGroupId);

    // Browser traffic reaches the durable object with EdgeService-issued tokens (the
    // edge forwards any subpath); the action route is for internal services only —
    // browsers must use the websocket protocol.
    await expect(
        durableObjectTest.fetchForTest(
            context.systemAction(space.id, {serviceName: "EdgeService"}),
            databaseGroupId,
            new Request("https://databases.test.invalid/action", {
                method: "POST",
                body: JSON.stringify(
                    DatabaseActionObjectSchema.serialize({
                        name: "listTableIds",
                        input: {},
                    } as DatabaseActionObject),
                ),
            }),
        ),
    ).rejects.toThrow("Database actions over HTTP are restricted to internal services");
});

test("internal-only actions are available over HTTP but not public websocket procedures", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const client = await createTestClient(databaseGroupId);
    const createTableInput = createTableInputForTest("Projects");

    await expect(executeAction(client, "createTable", createTableInput)).rejects.toThrow(
        "Database action createTable is internal-only",
    );
    expect(client.executeActionCalls).toEqual([]);

    const space = await getOrCreateTestSpaceForDatabaseGroupId(databaseGroupId);
    const session = await space.createSession();
    const serverConnection = await durableObjectTest.connectForTest(
        context.action(session),
        databaseGroupId,
    );
    await expect(
        serverConnection.procedures.executeAction({
            action: {name: "createTable", input: createTableInput} as DatabaseActionObject,
            mutationId: generateId(),
            returnResult: true,
            returnPages: true,
            registerTables: new Map(),
        }),
    ).rejects.toThrow("Database action createTable is internal-only");

    const table = await executeInternalAction(databaseGroupId, "createTable", createTableInput);
    await expect(
        serverConnection.procedures.executeAction({
            action: {
                name: "syncTableMetadata",
                input: {
                    tableId: table.tableId,
                    name: "Projects",
                    accessPolicy: createTableInput.accessPolicy,
                },
            } as DatabaseActionObject,
            mutationId: generateId(),
            returnResult: true,
            returnPages: true,
            registerTables: new Map(),
        }),
    ).rejects.toThrow("Database action syncTableMetadata is internal-only");
    await executeInternalAction(databaseGroupId, "syncTableMetadata", {
        tableId: table.tableId,
        name: "Projects",
        accessPolicy: createTableInput.accessPolicy,
    });

    serverConnection.close();
});

test("a warm client can use an internally created table", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const client = await createWarmClient(databaseGroupId, table);

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
        registerTableCalls: reader.registerTableCalls,
    }).toEqual({
        firstRead: [],
        secondRead: [],
        // Only the first read hit the server; the second was served locally.
        executeActionCalls: [{name: "readonlyRawSql", returnResult: true}],
        // No durable pages existed to register before the fallback.
        registerTableCalls: [],
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

// SQLite clears a `DELETE` with no `WHERE` clause by truncating the table's btree
// instead of rewriting row pages, which could fool the client's write detection
// ("no written pages means pure read") into never sending the mutation. It
// doesn't: the truncating transaction still rewrites the header page, so the
// action is classified as a mutation, reaches the server, and the truncate
// replicates to peers via `fileSizeInPages`. This test pins that.
test("a DELETE without a WHERE clause replicates to the server and peers", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    await executeAction(writer, "rawSql", {
        sql: sql`DELETE FROM ${sql.tableRef(table.tableId, table.tableName)}`.query,
    });
    await settle();

    expect({
        writerRowIds: await selectRowIds(writer, table),
        readerRowIds: await selectRowIds(reader, table),
    }).toEqual({
        writerRowIds: [],
        readerRowIds: [],
    });
});

test("a fresh client fetches another client\u2019s table once", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createTestClient(databaseGroupId);
    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    // The connected reader holds none of the table's pages, so the mutation sends it
    // nothing. Its first read routes to the server and warms the cache exactly once.
    const executeActionCallsBeforeRead = [...reader.executeActionCalls];
    const firstRead = await selectRowIds(reader, table);
    const secondRead = await selectRowIds(reader, table);

    expect({
        executeActionCallsBeforeRead,
        firstRead,
        secondRead,
        executeActionCalls: reader.executeActionCalls,
    }).toEqual({
        executeActionCallsBeforeRead: [],
        firstRead: [rowId],
        secondRead: [rowId],
        executeActionCalls: [{name: "readonlyRawSql", returnResult: true}],
    });
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

test("realtime materializes appended pages for a warmed client", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);
    const readerGroupDir = await reader.dir.getDirectoryHandle(databaseGroupId);
    const pagesBefore = await extractOpfsTablePages(readerGroupDir, table.tableId);

    await executeAction(writer, "rawSql", {
        sql: sql`
            WITH RECURSIVE
                sequence (n) AS (
                    VALUES
                        (1)
                    UNION ALL
                    SELECT
                        n + 1
                    FROM
                        sequence
                    WHERE
                        n < 1000
                )
            INSERT INTO
                ${sql.tableRef(table.tableId, table.tableName)} (_id)
            SELECT
                generate_id ()
            FROM
                sequence
        `.query,
    });
    await settle();

    const pagesAfter = await extractOpfsTablePages(readerGroupDir, table.tableId);
    const clientPagesByIndex = new Map(pagesAfter.pages.map(page => [page.pageIndex, page]));
    const serverPages = extractServerPages(databaseGroupId, [table.tableId]).get(table.tableId)!;
    const mismatchedPageIndexes: Array<number> = [];
    for (const [pageIndex, serverPage] of serverPages) {
        const clientPage = clientPagesByIndex.get(pageIndex);
        if (
            clientPage === undefined ||
            clientPage.data.some((byte, byteIndex) => byte !== serverPage.data[byteIndex])
        ) {
            mismatchedPageIndexes.push(pageIndex);
        }
    }
    assert(
        mismatchedPageIndexes.length === 0,
        `realtime cache differs on pages ${mismatchedPageIndexes.join(",")}; client has ${[
            ...clientPagesByIndex.keys(),
        ].join(",")}; server has ${[...serverPages.keys()].join(",")}`,
    );
    const {rows} = await executeAction(reader, "readonlyRawSql", {
        sql: sql`
            SELECT
                COUNT(*) AS count
            FROM
                ${sql.tableRef(table.tableId, table.tableName)}
        `.query,
    });
    expect({
        count: (rows[0] as {count: number}).count,
        executeActionCalls: reader.executeActionCalls,
        appendedPages: pagesAfter.pages.length > pagesBefore.pages.length,
    }).toEqual({
        count: 1000,
        executeActionCalls: [],
        appendedPages: true,
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
// reconnect the manager re-registers the previous epoch's working set before local
// reads can be trusted — without its bounded catch-up, reads would serve the
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

// The reconnect revalidation must cover schema changes too: the per-db file's
// sqlite_schema pages changed while the socket was down, and after they land the
// reader's next prepare must re-parse the schema rather than serve the stale copy.
test("a schema change made while disconnected is visible after reconnecting", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const writer = await createWarmClient(databaseGroupId, table);
    const reader = await createWarmClient(databaseGroupId, table);

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();

    reader.goOffline();
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
    reader.goOnline();
    await settle();

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

// Reconnect revalidation re-executes reactive actions whose pages changed while
// the socket was down, so watchers converge without any local interaction.
test("a reactive action catches up on writes missed while disconnected", async () => {
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

    watcher.goOffline();
    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeAction(writer, "createRow", {tableId: table.tableId, rowId});
    await settle();
    watcher.goOnline();
    await settle();

    expect(watcher.reactiveUpdates).toEqual([
        {name: "readonlyRawSql", output: {rows: [{_id: rowId}]}},
    ]);
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

test("a restarted client catches up the main registry at first touch", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const stale = await createWarmClient(databaseGroupId, table);
    stale.close();

    // While the browser is gone, another client registers a second table (a main
    // registry change).
    const secondTable = await executeInternalAction(
        databaseGroupId,
        "createTable",
        createTableInputForTest("Tasks"),
    );
    await settle();

    // The first registry touch registers main and applies its catch-up before retrying
    // the read locally.
    const restarted = await restartClient(stale, databaseGroupId);
    const {tableIds} = await executeAction(restarted, "listTableIds", {});

    expect([...tableIds].sort()).toEqual([table.tableId, secondTable.tableId].sort());
});

// Guards lazy store enumeration: the first touch registers every table cached in
// the group's OPFS directory and applies catch-up before attaching the requested
// table.
test("a restarted client catches up cached per-table files at first touch", async () => {
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

test("concurrent reconnects register once per client without page point reads", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const clients: Array<TestDatabaseClient> = [];
    for (let i = 0; i < 5; i++) {
        clients.push(await createWarmClient(databaseGroupId, table));
    }

    for (const client of clients) {
        client.goOffline();
    }
    const readPage = import.meta.jest.spyOn(DatabaseServer.prototype, "readPage");
    for (const client of clients) {
        client.goOnline();
    }
    await settle();
    const readPageCalls = readPage.mock.calls.length;
    readPage.mockRestore();

    expect({
        registrationTableCounts: clients.map(client =>
            client.registerTableCalls.slice(1).map(registration => registration.size),
        ),
        readPageCalls,
    }).toEqual({
        registrationTableCounts: clients.map(() => [table.seedPages.size]),
        readPageCalls: 0,
    });
});

test("access revocation drops the subscription until the next read", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const space = await getOrCreateTestSpaceForDatabaseGroupId(databaseGroupId);
    const session = await space.createSession();
    const allowedAccessPolicy = {
        ...databaseTableAccessPolicyForCreator(generateId<AccountId>()),
        defaultGrant: {level: "Manage" as const, generation: 0},
    };
    await createDatabaseTableMetadataForTest(context.action(session), {
        databaseGroupId,
        tableId: table.tableId,
        spaceId: space.id,
        name: "Projects",
        accessPolicy: allowedAccessPolicy,
    });
    context.takeDurableObjectBroadcasts();
    const reader = await createWarmClient(databaseGroupId, table);

    await updateDatabaseTableAccessPolicy(context.action(session), {
        spaceId: space.id,
        tableId: table.tableId,
        accessPolicy: {...allowedAccessPolicy, defaultGrant: null},
    });
    await deliverRecordedTableMetadataBroadcast(databaseGroupId, space.id);
    await settle();

    await updateDatabaseTableAccessPolicy(context.action(session), {
        spaceId: space.id,
        tableId: table.tableId,
        accessPolicy: allowedAccessPolicy,
    });
    await deliverRecordedTableMetadataBroadcast(databaseGroupId, space.id);
    await settle();

    const rowId = generateChronologicalId<DatabaseRowId>();
    await executeInternalAction(databaseGroupId, "createRow", {tableId: table.tableId, rowId});
    await settle();
    const executeActionCallsBeforeRead = [...reader.executeActionCalls];
    const rowIds = await selectRowIds(reader, table);

    expect({
        executeActionCallsBeforeRead,
        rowIds,
        executeActionCalls: reader.executeActionCalls,
    }).toEqual({
        executeActionCallsBeforeRead: [],
        rowIds: [rowId],
        executeActionCalls: [{name: "readonlyRawSql", returnResult: true}],
    });
});

// ---------------------------------------------------------------------------
// Out-of-band mutations
// ---
//
// ---

// The durable object's HTTP `/action` route executes mutations from outside the
// websocket protocol — loaders, server-side agents. It must broadcast
// `PagesChanged` like websocket mutations do, or every connected client keeps
// serving the pre-mutation state until some unrelated mutation happens to touch
// the same pages.
test("a mutation through the HTTP action route reaches realtime subscribers", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const table = await createTableOnServer(databaseGroupId);
    const reader = await createWarmClient(databaseGroupId, table);

    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const rowId = generateChronologicalId<DatabaseRowId>();
    const response = await durableObjectTest.fetchForTest(
        context.action(session),
        databaseGroupId,
        new Request("https://databases.test.invalid/action", {
            method: "POST",
            body: JSON.stringify(
                DatabaseActionObjectSchema.serialize({
                    name: "createRow",
                    input: {tableId: table.tableId, rowId},
                }),
            ),
        }),
    );
    assert(response.status === 200, `action route returned ${response.status}`);
    await settle();

    expect(await selectRowIds(reader, table)).toEqual([rowId]);
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
    readonly registerTableCalls: Array<DatabaseTableRegistrations>;
    readonly dir: OpfsDirectoryHandle;
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
     * after the table was created, plus the global snapshot watermark it reflects.
     */
    readonly seedPages: DatabasePages;
    readonly seedWatermark: number;
}

/**
 * Wires a real {@link DatabaseConnectionManager} to the real durable object
 * server, standing in for one browser. Each client gets its own OPFS directory
 * unless one is supplied to model a restart (see {@link restartClient}).
 */
async function createTestClient(
    databaseGroupId: DatabaseGroupId,
    options: {dir?: OpfsDirectoryHandle} = {},
): Promise<TestDatabaseClient> {
    const space = await getOrCreateTestSpaceForDatabaseGroupId(databaseGroupId);
    const session = await space.createSession();
    const dir = options.dir ?? createInMemoryOpfsDirectoryHandle();
    const serverConnection = await durableObjectTest.connectForTest(
        context.action(session),
        databaseGroupId,
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
    const registerTableCalls: Array<DatabaseTableRegistrations> = [];
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
                registerTableCalls,
            }),
    });
    manager.connectDatabaseGroup({
        databaseGroupId,
        webSocketUrl: "ws://test.invalid",
    });

    return {
        manager,
        tabConnection,
        reportedErrors,
        reactiveUpdates,
        executeActionCalls,
        registerTableCalls,
        dir,
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

async function getOrCreateTestSpaceForDatabaseGroupId(
    databaseGroupId: DatabaseGroupId,
): Promise<TestSpace> {
    const existing = testSpacesByDatabaseGroupId.get(databaseGroupId);
    if (existing !== undefined) {
        return existing;
    }
    const space = await TestSpace.create(context, {databaseGroupId});
    testSpacesByDatabaseGroupId.set(databaseGroupId, space);
    return space;
}

/**
 * Model a browser restart: close the client's server connection and stand up a
 * fresh manager (fresh SQLite connection and connection epoch) on the same OPFS
 * directory.
 */
async function restartClient(
    client: TestDatabaseClient,
    databaseGroupId: DatabaseGroupId,
): Promise<TestDatabaseClient> {
    client.close();
    return await createTestClient(databaseGroupId, {
        dir: client.dir,
    });
}

/**
 * Create the group's table through the internal HTTP action route and snapshot the
 * group's pages for seeding warm clients.
 */
async function createTableOnServer(databaseGroupId: DatabaseGroupId): Promise<TestDatabaseTable> {
    const {tableId, tableName} = await executeInternalAction(
        databaseGroupId,
        "createTable",
        createTableInputForTest("Projects"),
    );
    await settle();
    const seedPages = extractServerPages(databaseGroupId, [databaseMainTableId, tableId]);
    const durableObjectStorage = durableObjectStorages.get(databaseGroupId);
    assert(durableObjectStorage !== undefined);
    const seedWatermark =
        sql`
            SELECT
                MAX(last_version)
            FROM
                database_tables
        `.selectValue(durableObjectStorage.sql, Schema.integer.nullable()) ?? 0;
    return {tableId, tableName, seedPages, seedWatermark};
}

async function executeInternalAction<const Name extends DatabaseActionName>(
    databaseGroupId: DatabaseGroupId,
    name: Name,
    input: DatabaseActionInput<Name>,
): Promise<DatabaseActionOutput<Name>> {
    const space = await getOrCreateTestSpaceForDatabaseGroupId(databaseGroupId);
    const response = await durableObjectTest.fetchForTest(
        context.systemAction(space.id, {serviceName: "AppService"}),
        databaseGroupId,
        new Request("https://databases.test.invalid/action", {
            method: "POST",
            body: JSON.stringify(
                DatabaseActionObjectSchema.serialize({name, input} as DatabaseActionObject),
            ),
        }),
    );
    assert(response.status === 200, `action route returned ${response.status}`);
    const {result} = DatabaseActionFetchResponseSchema.deserialize(await response.json());
    assert(result.name === name);
    return result.output as DatabaseActionOutput<Name>;
}

async function deliverRecordedTableMetadataBroadcast(
    databaseGroupId: DatabaseGroupId,
    spaceId: SpaceId,
): Promise<void> {
    const broadcasts = context.takeDurableObjectBroadcasts();
    const groupBroadcasts = broadcasts.filter(broadcast => broadcast.url.includes(databaseGroupId));
    const broadcast = groupBroadcasts[groupBroadcasts.length - 1];
    assert(broadcast !== undefined, `expected a metadata broadcast for ${databaseGroupId}`);
    assert(broadcast.body !== undefined && broadcast.body !== null);
    const response = await durableObjectTest.fetchForTest(
        context.systemAction(spaceId, {serviceName: "AppService"}),
        databaseGroupId,
        new Request(
            "https://databases.test.invalid/broadcast-table-metadata-realtime-event-transaction",
            {
                method: "POST",
                body: JSON.stringify(broadcast.body),
            },
        ),
    );
    assert(response.status === 200, `metadata broadcast returned ${response.status}`);
}

/**
 * Snapshot every page of the given tables straight from the durable object's
 * canonical storage: the complete, versioned page set a fully warmed client holds.
 * Models durable OPFS state left by an earlier browser session.
 */
function extractServerPages(
    databaseGroupId: DatabaseGroupId,
    tableIds: ReadonlyArray<DatabaseTableId>,
): DatabasePages {
    const durableObjectStorage = durableObjectStorages.get(databaseGroupId);
    assert(
        durableObjectStorage !== undefined,
        `no durable object storage for group ${databaseGroupId}`,
    );

    // Read each table's latest live page rows straight out of the durable object's
    // page store (see the schema in `database_durable_object_sql_migrations.ts`).
    // Tombstoned pages (`data IS NULL`) are skipped, same as
    // `DatabaseServer.readPage`.
    const pages = new Map<DatabaseTableId, Map<number, {version: number; data: Uint8Array}>>();
    for (const tableId of tableIds) {
        const rows = sql`
            SELECT
                p.page_index,
                p.version,
                p.data
            FROM
                database_table_pages p
                JOIN database_tables t ON t.sqlite_id = p.sqlite_id
            WHERE
                t.table_id = ${tableId}
                AND p.version = (
                    SELECT
                        MAX(p2.version)
                    FROM
                        database_table_pages p2
                    WHERE
                        p2.sqlite_id = p.sqlite_id
                        AND p2.page_index = p.page_index
                )
                AND p.data IS NOT NULL
        `.selectAll(durableObjectStorage.sql, {
            pageIndex: Schema.integer.originalPropertyKey("page_index"),
            version: Schema.integer,
            data: Schema.bytes,
        });
        const tablePages = new Map<number, {version: number; data: Uint8Array}>();
        for (const row of rows) {
            tablePages.set(row.pageIndex, {version: row.version, data: row.data});
        }
        pages.set(tableId, tablePages);
    }
    return pages;
}

/**
 * Create a client with a complete durable OPFS snapshot. Its first touch registers
 * every cached table, applies catch-up, and then proves the requested table
 * operates locally without a server action.
 */
async function createWarmClient(
    databaseGroupId: DatabaseGroupId,
    table: TestDatabaseTable,
): Promise<TestDatabaseClient> {
    const dir = createInMemoryOpfsDirectoryHandle();
    const groupDir = await dir.getDirectoryHandle(databaseGroupId, {create: true});
    for (const [tableId, pages] of table.seedPages) {
        const fileSizeInPages = Math.max(-1, ...pages.keys()) + 1;
        await prepopulateOpfsTablePages(
            groupDir,
            tableId,
            fileSizeInPages,
            [...pages].map(([pageIndex, page]) => ({pageIndex, ...page})),
            table.seedWatermark,
        );
    }
    const client = await createTestClient(databaseGroupId, {dir});
    await selectRowIds(client, table);
    const registration = client.registerTableCalls[0];
    assert(registration !== undefined, "warm client did not register its durable cache");
    assert(client.registerTableCalls.length === 1, "warm client registered more than once");
    assert(
        registration.size === table.seedPages.size,
        "warm client did not register every cached table",
    );
    for (const [tableId, pages] of table.seedPages) {
        const entry = registration.get(tableId);
        assert(entry !== undefined, `warm registration omitted ${tableId}`);
        assert(entry.watermark === table.seedWatermark, `wrong watermark for ${tableId}`);
        assert(
            entry.heldPages.array().join(",") === [...pages.keys()].sort((a, b) => a - b).join(","),
            `wrong held pages for ${tableId}`,
        );
    }
    assert(
        client.executeActionCalls.length === 0,
        `warm client unexpectedly fell back to the server after ${client.registerTableCalls.length} registration calls`,
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
        registerTableCalls: Array<DatabaseTableRegistrations>;
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
            registerTables: async input => {
                options.registerTableCalls.push(input.tables);
                return await serverConnection.procedures.registerTables(input);
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
