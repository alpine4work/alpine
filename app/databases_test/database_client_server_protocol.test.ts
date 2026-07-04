import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseConnectionManager,
    type DatabaseConnectionManagerSocket,
    type DatabaseConnectionManagerTabConnection,
} from "~/client/web/databases/worker/database_connection_manager.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {DatabaseGroupDurableObject} from "~/server/databases/database_durable_object.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import {generateId} from "~/shared/id/id.js";
import type {BrowserId, DatabaseGroupId} from "~/shared/id/types/id_types.js";

const context = createTestWorkerContext();
const durableObjectTest = DatabaseGroupDurableObject.test(context, {
    createStorageForTest: () => new DurableObjectStorage(new MemoryStorage()),
});

type DatabaseServerConnection = Awaited<ReturnType<typeof durableObjectTest.connectForTest>>;

test("client executes actions against the database server", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const databaseGroupId = generateId<DatabaseGroupId>();
    const serverConnection = await durableObjectTest.connectForTest(
        context.action(session),
        databaseGroupId,
        {searchParams: new URLSearchParams([["browserId", generateId<BrowserId>()]])},
    );

    const reportedErrors: Array<string> = [];
    const tabConnection: DatabaseConnectionManagerTabConnection = {
        reactiveActionUpdated: async () => {},
        reactiveActionError: async () => {},
        reportError: async ({message}) => {
            reportedErrors.push(message);
        },
    };
    const manager = new DatabaseConnectionManager(
        createInMemoryOpfsDirectoryHandle(),
        () => [tabConnection],
        {createSocket: () => createSocketForServerConnection(serverConnection)},
    );
    manager.connectDatabaseGroup({
        databaseGroupId,
        pages: new Map(),
        webSocketUrl: "ws://test.invalid",
    });

    const createTableResult = await executeAction(manager, databaseGroupId, "createTable", {
        name: "Projects",
    });
    const tableRowsResult = await executeAction(manager, databaseGroupId, "readonlyRawSql", {
        sql: `
            SELECT
                id,
                kind
            FROM
                _alpine_tables
        `,
    });

    expect({rows: tableRowsResult.rows, reportedErrors}).toEqual({
        rows: [
            {
                id: createTableResult.tableId,
                kind: "table",
            },
        ],
        reportedErrors: [],
    });
});

/**
 * Adapts a durable object test connection into the socket interface {@link
 * DatabaseConnectionManager} expects from its `createSocket` dependency. Both
 * sides expose the same procedures mapped type over `DatabaseRealtimeProtocol`, so
 * calls pass straight through to the durable object. The test connection is
 * already connected, so `connect()` and `reconnect()` are no-ops and the state is
 * a constant "connected" snapshot.
 */
function createSocketForServerConnection(
    serverConnection: DatabaseServerConnection,
): DatabaseConnectionManagerSocket {
    return {
        procedures: serverConnection.procedures,
        state: {
            getSnapshot: () => ({
                hasError: false,
                isConnecting: false,
                isConnected: true,
                isDisconnected: false,
            }),
            subscribe: () => () => {},
        },
        subscribeToEvents: handler => serverConnection.subscribeToEvents(handler),
        connect() {},
        reconnect() {},
        async disconnect() {
            serverConnection.close();
        },
    };
}

async function executeAction<const Name extends DatabaseActionName>(
    manager: DatabaseConnectionManager,
    databaseGroupId: DatabaseGroupId,
    name: Name,
    input: DatabaseActionInput<Name>,
): Promise<DatabaseActionOutput<Name>> {
    const {result} = await manager.executeAction({
        databaseGroupId,
        action: {name, input} as DatabaseActionObject,
    });
    return result.output as DatabaseActionOutput<Name>;
}
