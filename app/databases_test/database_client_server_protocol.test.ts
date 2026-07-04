import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseClient,
    type DatabaseClientConnection,
} from "~/client/web/databases/worker/database_client.js";
import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {DatabaseDurableObjectConnection} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import type {
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import {InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {BrowserId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";

describe("database client/server protocol", () => {
    test("client can execute a server-only action through the real server connection", async () => {
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

            const tableRowsResult = await executeAction(client, connection, {
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
            serverHarness.server.close();
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

            connection.reconnect();
            const createTableResult = await executeAction(client, connection, {
                name: "createTable",
                input: {name: "Projects"},
            });

            const tableRowsResult = await executeAction(client, connection, {
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
            serverHarness.server.close();
        }
    });
});

async function createServerHarness(): Promise<{
    server: DatabaseServer;
    serverConnection: DatabaseDurableObjectConnection;
    createServerConnection(): DatabaseDurableObjectConnection;
    onPagesChanged: (event: {
        pageDiffs: Parameters<DatabaseClient["writePageDiffsFromRealtime"]>[0];
        mutationId: Parameters<DatabaseClient["writePageDiffsFromRealtime"]>[1];
    }) => void;
}> {
    const storage = new DurableObjectStorage(new MemoryStorage());
    const durableObjectStorage = new DatabaseDurableObjectStorage(storage.sql);
    const server = await DatabaseServer.create(durableObjectStorage);
    const browserId = generateId<BrowserId>();
    const browserPageTracker = new BrowserPageTracker();
    let serverConnection: DatabaseDurableObjectConnection | null = null;
    const harness = {
        server,
        get serverConnection() {
            if (serverConnection === null) {
                throw new InternalError("Database server connection has not been initialized");
            }
            return serverConnection;
        },
        createServerConnection() {
            const connection = new DatabaseDurableObjectConnection({
                server,
                storage,
                durableObjectStorage,
                processContext: null as any,
                sendEventToAll: (_context, event) => {
                    harness.onPagesChanged(event);
                },
                browserId,
                connectionId: generateId<WebSocketConnectionId>(),
                browserPageTracker,
            });
            serverConnection = connection;
            return connection;
        },
        onPagesChanged: () => {},
    };

    harness.createServerConnection();

    return harness;
}

function createReconnectableClientConnection(
    serverHarness: Awaited<ReturnType<typeof createServerHarness>>,
    options: {reportError(error: unknown): void},
): DatabaseClientConnection & {
    disconnect(): void;
    reconnect(): void;
    close(): void;
} {
    let isConnected = true;
    let serverConnection = serverHarness.serverConnection;

    function getServerConnection(): DatabaseDurableObjectConnection {
        if (!isConnected) {
            throw new InternalError("simulated websocket disconnect");
        }
        return serverConnection;
    }

    return {
        async executeActionServer(action, executeOptions) {
            return await getServerConnection().procedures.executeAction(
                null as any,
                {
                    action,
                    mutationId: executeOptions.mutationId,
                    returnResult: executeOptions.returnResult ?? true,
                    returnPages: executeOptions.returnPages ?? true,
                },
                null as any,
            );
        },
        async ensureCacheIsUpToDate(pageVersionsByIndex) {
            return await getServerConnection().procedures.ensureCacheIsUpToDate(
                null as any,
                {pageVersionsByIndex},
                null as any,
            );
        },
        acknowledgePages(pageIndexes) {
            void getServerConnection().procedures.acknowledgePages(
                null as any,
                {pageIndexes},
                null as any,
            );
        },
        reportError: options.reportError,
        disconnect() {
            isConnected = false;
            serverConnection.handleClose();
        },
        reconnect() {
            serverConnection = serverHarness.createServerConnection();
            isConnected = true;
        },
        close() {
            serverConnection.handleClose();
        },
    };
}

function createClientConnection(
    serverConnection: DatabaseDurableObjectConnection,
    options: {reportError(error: unknown): void},
): DatabaseClientConnection {
    return {
        async executeActionServer(action, executeOptions) {
            return await serverConnection.procedures.executeAction(
                null as any,
                {
                    action,
                    mutationId: executeOptions.mutationId,
                    returnResult: executeOptions.returnResult ?? true,
                    returnPages: executeOptions.returnPages ?? true,
                },
                null as any,
            );
        },
        async ensureCacheIsUpToDate(pageVersionsByIndex) {
            return await serverConnection.procedures.ensureCacheIsUpToDate(
                null as any,
                {pageVersionsByIndex},
                null as any,
            );
        },
        acknowledgePages(pageIndexes) {
            void serverConnection.procedures.acknowledgePages(
                null as any,
                {pageIndexes},
                null as any,
            );
        },
        reportError: options.reportError,
    };
}

async function executeAction<Name extends DatabaseActionName>(
    client: DatabaseClient,
    connection: DatabaseClientConnection,
    action: DatabaseActionObject<Name>,
): Promise<DatabaseActionOutput<Name>> {
    const result = await client.executeAction(connection, action);
    if (result === undefined) {
        throw new InternalError("Database action unexpectedly returned no result");
    }
    return result;
}
