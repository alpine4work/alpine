import "~/client/web/databases/worker/sqlite3_wasm_init_worker.js";

import {
    DatabaseConnectionManager,
    DatabaseConnectionManagerTabConnection,
} from "~/client/web/databases/worker/database_connection_manager.js";
import {
    WorkerToTabDatabaseRpcMethods,
    tabToWorkerDatabaseRpcMethods,
    workerToTabDatabaseRpcMethods,
} from "~/client/web/databases/worker/database_worker_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {
    UniqueWorkerHost,
    UniqueWorkerHostConnection,
} from "~/client/web/helpers/workers/unique_worker_host.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

// Entry script for the databases unique worker. The host must attach before the
// first `connect-port` message can arrive, so OPFS initialization happens behind a
// promise while the message listener is installed synchronously.
const dir: Promise<OpfsDirectoryHandle> = (async () => {
    const root: OpfsDirectoryHandle = await (navigator.storage as any).getDirectory();
    return await root.getDirectoryHandle("databases", {create: true});
})();

type RealConnection = UniqueWorkerHostConnection<
    typeof tabToWorkerDatabaseRpcMethods,
    typeof workerToTabDatabaseRpcMethods
>;

const connections = new WeakMap<RealConnection, DatabaseConnectionManagerTabConnection>();
function wrapConnection(connection: RealConnection): DatabaseConnectionManagerTabConnection {
    return getOrSetDefaultMapValue(connections, connection, () => ({
        reactiveActionUpdated: async (
            input: WorkerToTabDatabaseRpcMethods["reactiveActionUpdated"]["input"],
        ) => {
            await connection.call("reactiveActionUpdated", input);
        },
        reactiveActionError: async (
            input: WorkerToTabDatabaseRpcMethods["reactiveActionError"]["input"],
        ) => {
            await connection.call("reactiveActionError", input);
        },
        reportError: async (input: WorkerToTabDatabaseRpcMethods["reportError"]["input"]) => {
            await connection.call("reportError", input);
        },
    }));
}

const host = new UniqueWorkerHost({
    workerMethods: tabToWorkerDatabaseRpcMethods,
    tabMethods: workerToTabDatabaseRpcMethods,
    handlers: {
        connectDatabaseGroup: async input => clientManager.connectDatabaseGroup(input),
        executeAction: async input => {
            return await clientManager.executeAction(input);
        },
        registerReactiveAction: async (input, connection) => {
            return await clientManager.registerReactiveAction(input, wrapConnection(connection));
        },
        unregisterReactiveAction: async input => {
            await clientManager.unregisterReactiveAction(input);
            return {};
        },
    },
    onDisconnect: connection => {
        clientManager.disconnectClient(wrapConnection(connection));
    },
});

const clientManager: DatabaseConnectionManager = new DatabaseConnectionManager(dir, () =>
    host.connections.map(wrapConnection),
);

host.listen();
