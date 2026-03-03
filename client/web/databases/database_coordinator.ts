import {databaseWorkerMethods} from "~/client/web/databases/database_worker_methods.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";

type DatabaseRpc = WebWorkerRpc<typeof databaseWorkerMethods>;

export interface DatabaseConnection {
    readonly rpc: DatabaseRpc;
    close(): void;
}

/**
 * Connect to the shared client-side SQLite database.
 * Handles multi-tab coordination transparently: one
 * tab becomes the leader (runs SQLite in a dedicated
 * worker), others proxy queries via MessagePort through
 * the ServiceWorker.
 */
export async function connectToDatabase(): Promise<DatabaseConnection> {
    const isLeader = await tryAcquireLeaderLock();

    if (isLeader) {
        return connectAsLeader();
    } else {
        return connectAsFollower();
    }
}

/**
 * Try to acquire the exclusive "alpine-db" Web Lock.
 * Returns `true` if this tab is the leader, `false` if
 * another tab already holds the lock.
 */
function tryAcquireLeaderLock(): Promise<boolean> {
    return new Promise(resolve => {
        navigator.locks.request("alpine-db", {ifAvailable: true}, async lock => {
            if (lock === null) {
                resolve(false);
                return;
            }
            resolve(true);
            // Hold the lock forever — released when the tab dies
            await new Promise(() => {});
        });
    });
}

/**
 * Leader path: spawn the dedicated worker, set up local
 * RPC, register with the ServiceWorker, and forward
 * incoming MessagePorts from followers to the worker.
 */
async function connectAsLeader(): Promise<DatabaseConnection> {
    const worker = new Worker(new URL("./database_worker.js", import.meta.url), {
        type: "module",
    });

    // Wait for the worker to finish initializing
    await new Promise<void>(resolve => {
        worker.onmessage = event => {
            if (event.data?.type === "ready") {
                resolve();
            }
        };
    });

    // Set up local RPC for this tab's queries
    const rpc = new WebWorkerRpc({
        methods: databaseWorkerMethods,
        handlers: {} as any,
        send: message => worker.postMessage(message),
    });
    worker.onmessage = event => rpc.handleMessage(event.data);

    // Register as leader with the ServiceWorker and forward
    // incoming ports from followers to the worker
    const registration = await navigator.serviceWorker.ready;
    registration.active!.postMessage({type: "db-register-leader"});

    navigator.serviceWorker.addEventListener("message", event => {
        if (event.data?.type === "db-port") {
            const port = event.ports[0];
            if (port) {
                worker.postMessage({type: "port"}, [port]);
            }
        }
    });

    return {
        rpc,
        close() {
            worker.terminate();
        },
    };
}

/**
 * Follower path: ask the ServiceWorker for a MessagePort
 * to the leader's worker, then set up RPC over that port.
 */
async function connectAsFollower(): Promise<DatabaseConnection> {
    const registration = await navigator.serviceWorker.ready;

    const channel = new MessageChannel();

    registration.active!.postMessage({type: "db-connect"}, [channel.port2]);

    const rpc = new WebWorkerRpc({
        methods: databaseWorkerMethods,
        handlers: {} as any,
        send: message => channel.port1.postMessage(message),
    });
    channel.port1.onmessage = event => rpc.handleMessage(event.data);
    channel.port1.start();

    return {
        rpc,
        close() {
            channel.port1.close();
        },
    };
}
