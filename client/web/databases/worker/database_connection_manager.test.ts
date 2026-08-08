import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseConnectionManager,
    type DatabaseConnectionManagerSocket,
    type DatabaseConnectionManagerTabConnection,
} from "~/client/web/databases/worker/database_connection_manager.js";
import type {DatabaseRealtimeEvent} from "~/shared/databases/database_realtime_protocol.js";
import {sql} from "~/shared/databases/sql.js";
import {InvalidArgumentError, UnavailableError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseGroupId, DatabaseMutationId} from "~/shared/id/types/id_types.open_source.js";

/**
 * A fake socket whose `executeAction` never responds (mutations stay queued
 * optimistically) and whose realtime events are delivered by the test through
 * `deliverEvent`.
 */
function makeTestSocket(
    options: {
        registerTables?: DatabaseConnectionManagerSocket["procedures"]["registerTables"];
    } = {},
): {
    socket: DatabaseConnectionManagerSocket;
    mutationIds: Array<DatabaseMutationId>;
    deliverEvent: (event: DatabaseRealtimeEvent) => void;
    setConnected: (connected: boolean) => void;
} {
    const mutationIds: Array<DatabaseMutationId> = [];
    const eventHandlers = new Set<(event: DatabaseRealtimeEvent) => void>();
    const stateListeners = new Set<() => void>();
    let connected = true;
    const socket: DatabaseConnectionManagerSocket = {
        procedures: {
            executeAction(input) {
                mutationIds.push(input.mutationId);
                return new Promise(() => {});
            },
            registerTables:
                options.registerTables ??
                (() => Promise.resolve({tables: new Map(), tableAccess: new Map()})),
        },
        state: {
            getSnapshot: () =>
                connected
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
            subscribe(listener) {
                stateListeners.add(listener);
                return () => {
                    stateListeners.delete(listener);
                };
            },
        },
        subscribeToEvents(handler) {
            eventHandlers.add(handler);
            return () => {
                eventHandlers.delete(handler);
            };
        },
        connect() {
            for (const listener of stateListeners) listener();
        },
        reconnect() {},
    };
    return {
        socket,
        mutationIds,
        deliverEvent(event) {
            for (const handler of eventHandlers) {
                handler(event);
            }
        },
        setConnected(nextConnected) {
            connected = nextConnected;
            for (const listener of stateListeners) listener();
        },
    };
}

// `writePageDiffsFromRealtime` asserts on confirmation order, so a realtime event
// processed at the wrong moment (e.g. a confirmation arriving before a failed
// earlier mutation's rejection handler dequeued it) throws inside the event
// handler's `.then`. That error must surface through `reportError` — an unhandled
// rejection would vanish silently with the confirmation dropped.
test("an error from realtime event processing is reported to tabs", async () => {
    const {socket, mutationIds, deliverEvent} = makeTestSocket();
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
        {createSocket: () => socket},
    );

    const databaseGroupId = generateId<DatabaseGroupId>();
    await manager.executeLocallyForTests(
        databaseGroupId,
        sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`,
    );
    await manager.commitOptimisticPagesForTests(databaseGroupId);

    // Queue two optimistic mutations (the server never responds).
    for (const id of [1, 2]) {
        await manager.executeAction({
            databaseGroupId,
            action: {name: "rawSql", input: {sql: `INSERT INTO t (id) VALUES (${id})`}},
        });
    }

    // Confirm the second mutation while the first is still queued — out of order.
    deliverEvent({
        type: "PagesChanged",
        pageDiffs: new Map(),
        mutationId: mutationIds[1]!,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(reportedErrors).toEqual([
        expect.stringContaining("unexpected mutation confirmation order"),
    ]);
});

test("retries transient cached-table registration failures", async () => {
    let registrationCalls = 0;
    let markRegistrationSucceeded!: () => void;
    const registrationSucceeded = new Promise<void>(resolve => {
        markRegistrationSucceeded = resolve;
    });
    const {socket, setConnected} = makeTestSocket({
        async registerTables() {
            registrationCalls++;
            if (registrationCalls === 1) {
                throw new UnavailableError("synthetic registration failure");
            }
            markRegistrationSucceeded();
            return {tables: new Map(), tableAccess: new Map()};
        },
    });
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
        {createSocket: () => socket},
    );
    const databaseGroupId = generateId<DatabaseGroupId>();
    await manager.executeLocallyForTests(databaseGroupId, sql`CREATE TABLE t (id INTEGER)`);
    await manager.commitOptimisticPagesForTests(databaseGroupId);
    manager.connectDatabaseGroup({databaseGroupId, webSocketUrl: "ws://test.invalid"});
    await new Promise(resolve => setTimeout(resolve, 0));

    setConnected(false);
    await Promise.resolve();
    setConnected(true);
    await registrationSucceeded;

    expect({registrationCalls, reportedErrors}).toEqual({
        registrationCalls: 2,
        reportedErrors: ["synthetic registration failure"],
    });
});

test("does not retry non-transient cached-table registration failures", async () => {
    let registrationCalls = 0;
    const {socket, setConnected} = makeTestSocket({
        async registerTables() {
            registrationCalls++;
            throw new InvalidArgumentError("synthetic registration failure");
        },
    });
    const reportedErrors: Array<string> = [];
    let markErrorReported!: () => void;
    const errorReported = new Promise<void>(resolve => {
        markErrorReported = resolve;
    });
    const tabConnection: DatabaseConnectionManagerTabConnection = {
        reactiveActionUpdated: async () => {},
        reactiveActionError: async () => {},
        reportError: async ({message}) => {
            reportedErrors.push(message);
            markErrorReported();
        },
    };
    const manager = new DatabaseConnectionManager(
        createInMemoryOpfsDirectoryHandle(),
        () => [tabConnection],
        {createSocket: () => socket},
    );
    const databaseGroupId = generateId<DatabaseGroupId>();
    await manager.executeLocallyForTests(databaseGroupId, sql`CREATE TABLE t (id INTEGER)`);
    await manager.commitOptimisticPagesForTests(databaseGroupId);
    manager.connectDatabaseGroup({databaseGroupId, webSocketUrl: "ws://test.invalid"});
    await new Promise(resolve => setTimeout(resolve, 0));

    setConnected(false);
    await Promise.resolve();
    setConnected(true);
    await errorReported;

    expect({registrationCalls, reportedErrors}).toEqual({
        registrationCalls: 1,
        reportedErrors: ["synthetic registration failure"],
    });
});
