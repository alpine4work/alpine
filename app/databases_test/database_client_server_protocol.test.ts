import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseClient,
    type DatabaseClientConnection,
} from "~/client/web/databases/worker/database_client.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {DatabaseGroupDurableObject} from "~/server/databases/database_durable_object.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import {type DatabaseRealtimeEvent} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {BrowserId, DatabaseGroupId} from "~/shared/id/types/id_types.js";

const context = createTestWorkerContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);
const durableObjectTest = DatabaseGroupDurableObject.test(context, {
    createStorageForTest: () => new DurableObjectStorage(new MemoryStorage()),
});

type DatabaseServerConnection = Awaited<ReturnType<typeof durableObjectTest.connectForTest>>;

describe("database client/server protocol", () => {
    test("client can execute a server-only action through the real durable object", async () => {
        const serverHarness = await createServerHarness();
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const reportedErrors: Array<unknown> = [];
        serverHarness.onPagesChanged = event => {
            client.writePageDiffsFromRealtime(event.pageDiffs, event.mutationId);
        };
        const connection = createClientConnection(serverHarness.serverConnection, {
            reportError: error => reportedErrors.push(error),
        });

        try {
            await client.ensureCacheIsUpToDate(connection);

            const createTableResult = await executeAction(client, connection, {
                name: "createTable",
                input: {name: "Projects"},
            });

            const tableRowsResult = await executeAction<"readonlyRawSql">(client, connection, {
                name: "readonlyRawSql",
                input: {
                    sql: `
                        SELECT
                            id,
                            kind
                        FROM
                            _alpine_tables
                    `,
                },
            });

            expect(tableRowsResult.rows).toEqual([
                {
                    id: createTableResult.tableId,
                    kind: "table",
                },
            ]);
            expect(reportedErrors).toEqual([]);
        } finally {
            client.close();
            serverHarness.serverConnection.close();
        }
    });

    test("client can resume server actions after a simulated websocket reconnect", async () => {
        const serverHarness = await createServerHarness();
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const reportedErrors: Array<unknown> = [];
        serverHarness.onPagesChanged = event => {
            client.writePageDiffsFromRealtime(event.pageDiffs, event.mutationId);
        };
        const connection = createReconnectableClientConnection(serverHarness, {
            reportError: error => reportedErrors.push(error),
        });

        try {
            await client.ensureCacheIsUpToDate(connection);

            connection.disconnect();
            await expect(
                executeAction(client, connection, {
                    name: "createTable",
                    input: {name: "Projects"},
                }),
            ).rejects.toThrow("simulated websocket disconnect");

            await connection.reconnect();
            const createTableResult = await executeAction<"createTable">(client, connection, {
                name: "createTable",
                input: {name: "Projects"},
            });

            const tableRowsResult = await executeAction<"readonlyRawSql">(client, connection, {
                name: "readonlyRawSql",
                input: {
                    sql: `
                        SELECT
                            id,
                            kind
                        FROM
                            _alpine_tables
                    `,
                },
            });

            expect(tableRowsResult.rows).toEqual([
                {
                    id: createTableResult.tableId,
                    kind: "table",
                },
            ]);
            expect(reportedErrors).toEqual([]);
        } finally {
            client.close();
            connection.close();
        }
    });
});

type DatabaseServerHarness = {
    serverConnection: DatabaseServerConnection;
    createServerConnection(): Promise<DatabaseServerConnection>;
    onPagesChanged: (event: DatabaseRealtimeEvent) => void;
};

async function createServerHarness(): Promise<DatabaseServerHarness> {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const browserId = generateId<BrowserId>();
    let serverConnection: DatabaseServerConnection | null = null;
    const harness: DatabaseServerHarness = {
        get serverConnection() {
            if (serverConnection === null) {
                throw new InternalError("Database server connection has not been initialized");
            }
            return serverConnection;
        },
        async createServerConnection() {
            const connection = await durableObjectTest.connectForTest(
                context.action(session),
                databaseGroupId,
                {searchParams: new URLSearchParams([["browserId", browserId]])},
            );
            connection.subscribeToEvents(event => {
                harness.onPagesChanged(event);
            });
            serverConnection = connection;
            return connection;
        },
        onPagesChanged: () => {},
    };

    await harness.createServerConnection();

    return harness;
}

function createReconnectableClientConnection(
    serverHarness: Awaited<ReturnType<typeof createServerHarness>>,
    options: {reportError: (error: unknown) => void},
): DatabaseClientConnection & {
    disconnect(): void;
    reconnect(): Promise<void>;
    close(): void;
} {
    let isConnected = true;
    let serverConnection = serverHarness.serverConnection;

    function getServerConnection(): DatabaseServerConnection {
        if (!isConnected) {
            throw new InternalError("simulated websocket disconnect");
        }
        return serverConnection;
    }

    return {
        async executeActionServer(action, executeOptions) {
            return await getServerConnection().procedures.executeAction({
                action,
                mutationId: executeOptions.mutationId,
                returnResult: executeOptions.returnResult ?? true,
                returnPages: executeOptions.returnPages ?? true,
            });
        },
        async ensureCacheIsUpToDate(pageVersionsByIndex) {
            return await getServerConnection().procedures.ensureCacheIsUpToDate({
                pageVersionsByIndex,
            });
        },
        acknowledgePages(pageIndexes) {
            void getServerConnection().procedures.acknowledgePages({pageIndexes});
        },
        reportError: options.reportError,
        disconnect() {
            isConnected = false;
            serverConnection.close();
        },
        async reconnect() {
            serverConnection = await serverHarness.createServerConnection();
            isConnected = true;
        },
        close() {
            serverConnection.close();
        },
    };
}

function createClientConnection(
    serverConnection: DatabaseServerConnection,
    options: {reportError: (error: unknown) => void},
): DatabaseClientConnection {
    return {
        async executeActionServer(action, executeOptions) {
            return await serverConnection.procedures.executeAction({
                action,
                mutationId: executeOptions.mutationId,
                returnResult: executeOptions.returnResult ?? true,
                returnPages: executeOptions.returnPages ?? true,
            });
        },
        async ensureCacheIsUpToDate(pageVersionsByIndex) {
            return await serverConnection.procedures.ensureCacheIsUpToDate({
                pageVersionsByIndex,
            });
        },
        acknowledgePages(pageIndexes) {
            void serverConnection.procedures.acknowledgePages({pageIndexes});
        },
        reportError: options.reportError,
        close() {
            serverConnection.close();
        },
    };
}

async function executeAction<const Name extends DatabaseActionName>(
    client: DatabaseClient,
    connection: DatabaseClientConnection,
    name: Name,
    input: DatabaseActionInput<Name>,
): Promise<DatabaseActionOutput<Name>> {
    const result = await client.executeAction(connection, {name, input} as any);
    if (result === undefined) {
        throw new InternalError("Database action unexpectedly returned no result");
    }
    return result as any;
}
