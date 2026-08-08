import {jest} from "@jest/globals";
import type {
    DatabaseActionName,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.open_source.js";

type MockUniqueWorkerClientOptions = {
    key: string;
    handlers: {
        reportError(input: {message: string}): Promise<unknown>;
        reactiveActionUpdated(input: {
            id: DatabaseReactiveActionId;
            result: {name: DatabaseActionName; output: DatabaseActionOutput<DatabaseActionName>};
        }): Promise<unknown>;
        reactiveActionError(input: {
            id: DatabaseReactiveActionId;
            message: string;
        }): Promise<unknown>;
    };
    onReconnect?(): Promise<void> | void;
    onFailed?(error: Error): void;
    onOutdated?(): void;
};

class MockUniqueWorkerClient {
    static instances: Array<MockUniqueWorkerClient> = [];
    static nextWhenConnected: Promise<void> | null = null;

    readonly closeMock = jest.fn();
    readonly callMock = jest.fn(async (method: string, input: any): Promise<any> => {
        switch (method) {
            case "connectDatabaseGroup":
            case "unregisterReactiveAction":
                return {};
            case "executeAction":
                return {
                    result: {
                        name: input.action.name,
                        output: this.executeOutput,
                    },
                };
            case "registerReactiveAction":
                return {
                    result: {
                        name: input.action.name,
                        output: this.registerOutput,
                    },
                    error: this.registerError,
                };
            default:
                throw new InternalError(`Unexpected worker call: ${method}`);
        }
    });

    executeOutput: unknown = {rows: [{value: "execute-output"}]};
    registerOutput: unknown = {rows: [{value: "register-output"}]};
    registerError: string | null = null;

    private readonly whenConnectedPromise: Promise<void>;

    constructor(readonly options: MockUniqueWorkerClientOptions) {
        this.whenConnectedPromise = MockUniqueWorkerClient.nextWhenConnected ?? Promise.resolve();
        MockUniqueWorkerClient.instances.push(this);
    }

    async whenConnected(): Promise<void> {
        await this.whenConnectedPromise;
    }

    async call(method: string, input: unknown): Promise<unknown> {
        return await this.callMock(method, input);
    }

    close(): void {
        this.closeMock();
    }

    async reconnect(): Promise<void> {
        await this.options.onReconnect?.();
    }

    async reportError(message: string): Promise<void> {
        await this.options.handlers.reportError({message});
    }

    fail(error: Error): void {
        this.options.onFailed?.(error);
    }

    async updateReactiveAction(
        id: DatabaseReactiveActionId,
        output: DatabaseActionOutput<DatabaseActionName>,
    ): Promise<void> {
        await this.options.handlers.reactiveActionUpdated({
            id,
            result: {name: "readonlyRawSql", output},
        });
    }

    async errorReactiveAction(id: DatabaseReactiveActionId, message: string): Promise<void> {
        await this.options.handlers.reactiveActionError({id, message});
    }
}

jest.unstable_mockModule("../helpers/workers/unique_worker_client.js", () => ({
    UniqueWorkerClient: MockUniqueWorkerClient,
    uniqueWorkerWebLockName: (key: string) => `unique-worker:${key}`,
}));

const {createDatabaseGroupConnection, databaseUniqueWorkerKey} =
    await import("~/client/web/databases/connect_to_database.js");

const testDatabaseGroupId = generateId<DatabaseGroupId>();

function resetUniqueWorkerMock(): void {
    MockUniqueWorkerClient.instances = [];
    MockUniqueWorkerClient.nextWhenConnected = null;
}

function latestUniqueWorker(): MockUniqueWorkerClient {
    const instance = MockUniqueWorkerClient.instances.at(-1);
    if (instance === undefined) throw new InternalError("No UniqueWorkerClient was created");
    return instance;
}

function workerCalls(instance: MockUniqueWorkerClient): Array<{method: string; input: any}> {
    return instance.callMock.mock.calls.map(([method, input]) => ({method, input}));
}

afterEach(() => {
    resetUniqueWorkerMock();
    jest.clearAllMocks();
});

describe("createDatabaseGroupConnection", () => {
    test("queues calls until connect and injects the database group id", async () => {
        const db = createDatabaseGroupConnection();

        const executePromise = db.connection.executeAction("rawSql", {sql: "SELECT 1"});
        const watchPromise = db.connection.watchAction("readonlyRawSql", {sql: "SELECT 2"});

        await db.connect({
            databaseGroupId: testDatabaseGroupId,
            webSocketUrl: "ws://test.invalid",
        });
        const [executeOutput, watchHandle] = await runAllPromises([executePromise, watchPromise]);
        const instance = latestUniqueWorker();

        expect({
            executeOutput,
            key: instance.options.key,
            calls: workerCalls(instance),
            watchSnapshot: watchHandle.store.getSnapshot(),
        }).toMatchObject({
            executeOutput: {rows: [{value: "execute-output"}]},
            key: databaseUniqueWorkerKey,
            calls: [
                {
                    method: "connectDatabaseGroup",
                    input: {
                        databaseGroupId: testDatabaseGroupId,
                        webSocketUrl: "ws://test.invalid",
                    },
                },
                {
                    method: "executeAction",
                    input: {
                        databaseGroupId: testDatabaseGroupId,
                        action: {name: "rawSql", input: {sql: "SELECT 1"}},
                    },
                },
                {
                    method: "registerReactiveAction",
                    input: {
                        databaseGroupId: testDatabaseGroupId,
                        action: {name: "readonlyRawSql", input: {sql: "SELECT 2"}},
                    },
                },
            ],
            watchSnapshot: {ok: true, value: {rows: [{value: "register-output"}]}},
        });
    });

    test("close during connect rejects pending calls", async () => {
        let releaseWhenConnected!: () => void;
        MockUniqueWorkerClient.nextWhenConnected = new Promise(resolve => {
            releaseWhenConnected = resolve;
        });
        const db = createDatabaseGroupConnection();

        const pending = db.connection.executeAction("rawSql", {sql: "SELECT 1"});
        const pendingResult = pending.then(
            () => "resolved",
            error => error,
        );
        const connectPromise = db.connect({
            databaseGroupId: testDatabaseGroupId,
            webSocketUrl: "ws://test.invalid",
        });
        await Promise.resolve();
        const instance = latestUniqueWorker();

        db.connection.close();
        releaseWhenConnected();

        const [, error] = await runAllPromises([connectPromise, pendingResult]);
        expect({
            closeCount: instance.closeMock.mock.calls.length,
            error,
        }).toMatchObject({
            closeCount: 1,
            error: {message: "Connection closed before connect"},
        });
    });

    test("calls after close reject without creating a worker", async () => {
        const db = createDatabaseGroupConnection();

        db.connection.close();

        await expect(db.connection.executeAction("rawSql", {sql: "SELECT 1"})).rejects.toThrow(
            "Connection closed",
        );
        expect(MockUniqueWorkerClient.instances).toEqual([]);
    });
});

describe("watchAction", () => {
    test("maps initial results and worker pushes into the watch store", async () => {
        const db = createDatabaseGroupConnection();
        await db.connect({
            databaseGroupId: testDatabaseGroupId,
            webSocketUrl: "ws://test.invalid",
        });
        const instance = latestUniqueWorker();
        const handle = await db.connection.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});
        const registerCall = workerCalls(instance).find(
            call => call.method === "registerReactiveAction",
        );
        const id = registerCall!.input.id as DatabaseReactiveActionId;

        await instance.updateReactiveAction(id, {rows: [{value: "updated"}]} as any);
        const afterUpdate = handle.store.getSnapshot();
        await instance.errorReactiveAction(id, "query failed");

        expect({
            afterUpdate,
            afterError: handle.store.getSnapshot(),
        }).toMatchObject({
            afterUpdate: {ok: true, value: {rows: [{value: "updated"}]}},
            afterError: {ok: false, error: "query failed"},
        });
    });

    test("unwatch unregisters and ignores later worker pushes", async () => {
        const db = createDatabaseGroupConnection();
        await db.connect({
            databaseGroupId: testDatabaseGroupId,
            webSocketUrl: "ws://test.invalid",
        });
        const instance = latestUniqueWorker();
        const handle = await db.connection.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});
        const initialSnapshot = handle.store.getSnapshot();
        const registerCall = workerCalls(instance).find(
            call => call.method === "registerReactiveAction",
        );
        const id = registerCall!.input.id as DatabaseReactiveActionId;

        handle.unwatch();
        await Promise.resolve();
        await instance.updateReactiveAction(id, {rows: [{value: "ignored"}]} as any);

        expect({
            calls: workerCalls(instance).filter(call => call.method === "unregisterReactiveAction"),
            snapshot: handle.store.getSnapshot(),
        }).toMatchObject({
            calls: [
                {
                    method: "unregisterReactiveAction",
                    input: {
                        databaseGroupId: testDatabaseGroupId,
                        id,
                    },
                },
            ],
            snapshot: initialSnapshot,
        });
    });
});

describe("reconnect", () => {
    test("reconnects the database group and re-registers watches", async () => {
        const db = createDatabaseGroupConnection();
        await db.connect({
            databaseGroupId: testDatabaseGroupId,
            webSocketUrl: "ws://test.invalid",
        });
        const instance = latestUniqueWorker();
        const handle = await db.connection.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});
        const registerCall = workerCalls(instance).find(
            call => call.method === "registerReactiveAction",
        );
        const id = registerCall!.input.id as DatabaseReactiveActionId;
        instance.callMock.mockClear();
        instance.registerOutput = {rows: [{value: "after-reconnect"}]};

        await instance.reconnect();

        expect({
            calls: workerCalls(instance),
            snapshot: handle.store.getSnapshot(),
        }).toMatchObject({
            calls: [
                {
                    method: "connectDatabaseGroup",
                    input: {
                        databaseGroupId: testDatabaseGroupId,
                        webSocketUrl: "ws://test.invalid",
                    },
                },
                {
                    method: "registerReactiveAction",
                    input: {
                        databaseGroupId: testDatabaseGroupId,
                        id,
                        action: {
                            name: "readonlyRawSql",
                            input: {sql: "SELECT * FROM t"},
                        },
                    },
                },
            ],
            snapshot: {ok: true, value: {rows: [{value: "after-reconnect"}]}},
        });
    });
});

describe("error reporting", () => {
    test("forwards worker reportError and failed-client errors", async () => {
        const reportError = jest.fn();
        const db = createDatabaseGroupConnection();
        await db.connect({
            databaseGroupId: testDatabaseGroupId,
            webSocketUrl: "ws://test.invalid",
            reportError,
        });
        const instance = latestUniqueWorker();

        await instance.reportError("worker error");
        instance.fail(new InternalError("client failed"));

        expect(reportError.mock.calls).toEqual([["worker error"], ["client failed"]]);
    });
});
