/// <reference lib="webworker" />

type SharedUniqueWorkerRegisterLeaderMessage = {
    readonly type: "shared-unique-worker:register-leader";
    readonly key: string;
};

type SharedUniqueWorkerUnregisterLeaderMessage = {
    readonly type: "shared-unique-worker:unregister-leader";
    readonly key: string;
};

type SharedUniqueWorkerConnectMessage = {
    readonly type: "shared-unique-worker:connect";
    readonly key: string;
};

type SharedUniqueWorkerPortMessage = {
    readonly type: "shared-unique-worker:port";
    readonly key: string;
};

type SharedUniqueWorkerConnectErrorMessage = {
    readonly type: "shared-unique-worker:connect-error";
    readonly message: string;
};

type SharedUniqueWorkerBrokerMessage =
    | SharedUniqueWorkerRegisterLeaderMessage
    | SharedUniqueWorkerUnregisterLeaderMessage
    | SharedUniqueWorkerConnectMessage;

export type SharedUniqueWorkerClientMessage =
    | SharedUniqueWorkerPortMessage
    | SharedUniqueWorkerConnectErrorMessage;

/**
 * Installs the ServiceWorker-side MessagePort broker used by `UniqueSharedWorker`.
 *
 * The broker is intentionally small: it only tracks the current leader client for
 * each key and relays follower ports to that leader. Worker identity and protocol
 * compatibility are validated by the worker handshake.
 */
export function installSharedUniqueWorkerMessagePortBroker(options?: {
    scope?: ServiceWorkerGlobalScope;
}): void {
    const scope = options?.scope ?? (globalThis as unknown as ServiceWorkerGlobalScope);
    const leaderClientIdsByKey = new Map<string, string>();

    scope.addEventListener("message", event => {
        const message = receiveSharedUniqueWorkerBrokerMessage(event.data);
        if (message === null) return;

        switch (message.type) {
            case "shared-unique-worker:register-leader": {
                leaderClientIdsByKey.set(message.key, (event.source as Client).id);
                break;
            }

            case "shared-unique-worker:unregister-leader": {
                const sourceClientId = (event.source as Client).id;
                const leaderClientId = leaderClientIdsByKey.get(message.key);
                if (leaderClientId === sourceClientId) {
                    leaderClientIdsByKey.delete(message.key);
                }
                break;
            }

            case "shared-unique-worker:connect":
                event.waitUntil(
                    connectSharedUniqueWorkerFollower({
                        clients: scope.clients,
                        leaderClientIdsByKey,
                        key: message.key,
                        port: event.ports[0],
                    }),
                );
                break;
        }
    });
}

export function sendSharedUniqueWorkerRegisterLeaderMessage(
    target: ServiceWorker | {postMessage(message: unknown, transfer?: Array<Transferable>): void},
    key: string,
): void {
    target.postMessage(
        {
            type: "shared-unique-worker:register-leader",
            key,
        } satisfies SharedUniqueWorkerRegisterLeaderMessage,
        [],
    );
}

export function sendSharedUniqueWorkerUnregisterLeaderMessage(
    target: ServiceWorker | {postMessage(message: unknown, transfer?: Array<Transferable>): void},
    key: string,
): void {
    target.postMessage(
        {
            type: "shared-unique-worker:unregister-leader",
            key,
        } satisfies SharedUniqueWorkerUnregisterLeaderMessage,
        [],
    );
}

export function sendSharedUniqueWorkerConnectMessage(
    target: ServiceWorker | {postMessage(message: unknown, transfer?: Array<Transferable>): void},
    key: string,
    port: Transferable,
): void {
    target.postMessage(
        {
            type: "shared-unique-worker:connect",
            key,
        } satisfies SharedUniqueWorkerConnectMessage,
        [port],
    );
}

export function receiveSharedUniqueWorkerClientMessage(
    data: unknown,
): SharedUniqueWorkerClientMessage | null {
    return receiveSharedUniqueWorkerMessage(data) as SharedUniqueWorkerClientMessage | null;
}

function receiveSharedUniqueWorkerBrokerMessage(
    data: unknown,
): SharedUniqueWorkerBrokerMessage | null {
    return receiveSharedUniqueWorkerMessage(data) as SharedUniqueWorkerBrokerMessage | null;
}

function receiveSharedUniqueWorkerMessage(data: unknown): {readonly type: string} | null {
    const type = (data as {type?: unknown} | null)?.type;
    if (typeof type !== "string") return null;
    if (!type.startsWith("shared-unique-worker:")) return null;
    return data as {readonly type: string};
}

async function connectSharedUniqueWorkerFollower(options: {
    clients: Clients;
    leaderClientIdsByKey: Map<string, string>;
    key: string;
    port: MessagePort | undefined;
}): Promise<void> {
    const {clients, leaderClientIdsByKey, key, port} = options;
    if (port === undefined) return;

    const leaderClientId = leaderClientIdsByKey.get(key);
    if (leaderClientId === undefined) {
        sendSharedUniqueWorkerConnectErrorMessage(
            port,
            `No shared unique worker leader for ${key}`,
        );
        return;
    }

    const leaderClient = await clients.get(leaderClientId);
    if (leaderClient === undefined) {
        leaderClientIdsByKey.delete(key);
        sendSharedUniqueWorkerConnectErrorMessage(
            port,
            `No shared unique worker leader for ${key}`,
        );
        return;
    }

    sendSharedUniqueWorkerPortMessage(leaderClient, key, port);
}

function sendSharedUniqueWorkerPortMessage(target: Client, key: string, port: Transferable): void {
    target.postMessage(
        {
            type: "shared-unique-worker:port",
            key,
        } satisfies SharedUniqueWorkerPortMessage,
        [port],
    );
}

function sendSharedUniqueWorkerConnectErrorMessage(port: MessagePort, message: string): void {
    port.postMessage({
        type: "shared-unique-worker:connect-error",
        message,
    } satisfies SharedUniqueWorkerConnectErrorMessage);
    port.close();
}
