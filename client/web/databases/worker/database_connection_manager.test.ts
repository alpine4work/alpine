import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {
    DatabaseConnectionManager,
    type DatabaseConnectionManagerSocket,
    type DatabaseConnectionManagerTabConnection,
} from "~/client/web/databases/worker/database_connection_manager.js";
import type {DatabaseRealtimeEvent} from "~/shared/databases/database_realtime_protocol.js";
import {sql} from "~/shared/databases/sql.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseGroupId, DatabaseMutationId} from "~/shared/id/types/id_types.js";

/**
 * A fake socket whose `executeAction` never responds (mutations stay queued
 * optimistically) and whose realtime events are delivered by the test through
 * `deliverEvent`.
 */
function makeTestSocket(): {
    socket: DatabaseConnectionManagerSocket;
    mutationIds: Array<DatabaseMutationId>;
    deliverEvent: (event: DatabaseRealtimeEvent) => void;
} {
    const mutationIds: Array<DatabaseMutationId> = [];
    const eventHandlers = new Set<(event: DatabaseRealtimeEvent) => void>();
    const socket: DatabaseConnectionManagerSocket = {
        procedures: {
            executeAction(input) {
                mutationIds.push(input.mutationId);
                return new Promise(() => {});
            },
            async ensureCacheIsUpToDate() {
                return {tables: new Map(), tableAccess: new Map()};
            },
            async registerTables() {
                return {tables: new Map(), tableAccess: new Map()};
            },
            async acknowledgePages() {
                return {};
            },
        },
        state: {
            getSnapshot: () => ({
                hasError: false,
                isConnecting: false,
                isConnected: true,
                isDisconnected: false,
            }),
            subscribe: () => () => {},
        },
        subscribeToEvents(handler) {
            eventHandlers.add(handler);
            return () => {
                eventHandlers.delete(handler);
            };
        },
        connect() {},
        reconnect() {},
        async disconnect() {},
    };
    return {
        socket,
        mutationIds,
        deliverEvent(event) {
            for (const handler of eventHandlers) {
                handler(event);
            }
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
