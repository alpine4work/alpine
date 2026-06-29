export const sharedUniqueWorkerRegisterLeaderMessageType = "shared-unique-worker-register-leader";
export const sharedUniqueWorkerUnregisterLeaderMessageType =
    "shared-unique-worker-unregister-leader";
export const sharedUniqueWorkerConnectMessageType = "shared-unique-worker-connect";
export const sharedUniqueWorkerPortMessageType = "shared-unique-worker-port";
export const sharedUniqueWorkerConnectErrorMessageType = "shared-unique-worker-connect-error";

interface SharedUniqueWorkerBrokerClient {
    postMessage(message: unknown, transfer?: Array<Transferable>): void;
}

interface SharedUniqueWorkerBrokerClients {
    get(clientId: string): Promise<SharedUniqueWorkerBrokerClient | undefined>;
}

interface SharedUniqueWorkerBrokerMessageEvent {
    readonly data: unknown;
    readonly ports: ReadonlyArray<MessagePort>;
    readonly source: {readonly id?: string} | null;
    waitUntil(promise: Promise<unknown>): void;
}

interface SharedUniqueWorkerBrokerScope {
    readonly clients: SharedUniqueWorkerBrokerClients;
    addEventListener(
        type: "message",
        handler: (event: SharedUniqueWorkerBrokerMessageEvent) => void,
    ): void;
}

interface SharedUniqueWorkerRegisterLeaderMessage {
    readonly type: typeof sharedUniqueWorkerRegisterLeaderMessageType;
    readonly key: string;
}

interface SharedUniqueWorkerUnregisterLeaderMessage {
    readonly type: typeof sharedUniqueWorkerUnregisterLeaderMessageType;
    readonly key: string;
}

interface SharedUniqueWorkerConnectMessage {
    readonly type: typeof sharedUniqueWorkerConnectMessageType;
    readonly key: string;
}

type SharedUniqueWorkerBrokerMessage =
    | SharedUniqueWorkerRegisterLeaderMessage
    | SharedUniqueWorkerUnregisterLeaderMessage
    | SharedUniqueWorkerConnectMessage;

/**
 * Installs the ServiceWorker-side MessagePort broker used by `UniqueSharedWorker`.
 *
 * The broker is intentionally small: it only tracks the current leader client for
 * each key and relays follower ports to that leader. Worker identity and protocol
 * compatibility are validated by the worker handshake.
 */
export function installSharedUniqueWorkerMessagePortBroker(options?: {
    scope?: SharedUniqueWorkerBrokerScope;
}): void {
    const scope = options?.scope ?? (globalThis as unknown as SharedUniqueWorkerBrokerScope);
    const leaderClientIdsByKey = new Map<string, string>();

    scope.addEventListener("message", event => {
        const message = event.data as Partial<SharedUniqueWorkerBrokerMessage> | null;

        switch (message?.type) {
            case sharedUniqueWorkerRegisterLeaderMessageType:
                if (typeof message.key === "string" && event.source?.id !== undefined) {
                    leaderClientIdsByKey.set(message.key, event.source.id);
                }
                break;

            case sharedUniqueWorkerUnregisterLeaderMessageType:
                if (typeof message.key === "string" && event.source?.id !== undefined) {
                    const leaderClientId = leaderClientIdsByKey.get(message.key);
                    if (leaderClientId === event.source.id) {
                        leaderClientIdsByKey.delete(message.key);
                    }
                }
                break;

            case sharedUniqueWorkerConnectMessageType:
                if (typeof message.key !== "string") return;
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

async function connectSharedUniqueWorkerFollower(options: {
    clients: SharedUniqueWorkerBrokerClients;
    leaderClientIdsByKey: Map<string, string>;
    key: string;
    port: MessagePort | undefined;
}): Promise<void> {
    const {clients, leaderClientIdsByKey, key, port} = options;
    if (port === undefined) return;

    const leaderClientId = leaderClientIdsByKey.get(key);
    if (leaderClientId === undefined) {
        sendSharedUniqueWorkerConnectError(port, `No shared unique worker leader for ${key}`);
        return;
    }

    const leaderClient = await clients.get(leaderClientId);
    if (leaderClient === undefined) {
        leaderClientIdsByKey.delete(key);
        sendSharedUniqueWorkerConnectError(port, `No shared unique worker leader for ${key}`);
        return;
    }

    leaderClient.postMessage(
        {
            type: sharedUniqueWorkerPortMessageType,
            key,
        },
        [port],
    );
}

function sendSharedUniqueWorkerConnectError(port: MessagePort, message: string): void {
    port.postMessage({
        type: sharedUniqueWorkerConnectErrorMessageType,
        message,
    });
    port.close();
}
