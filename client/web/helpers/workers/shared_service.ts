import {AbortedError, UnavailableError, UnknownError} from "~/shared/error/error.js";

const providerRequestTimeout = 1000;
const defaultSharedWorkerPath = new URL("./SharedService_SharedWorker.js", import.meta.url);

const sharedWorker = globalThis.SharedWorker ? new SharedWorker(defaultSharedWorkerPath) : null;

// Shared across all SharedService instances in this browsing context — one lock
// per client context, not per service name.
let contextLockPromise: Promise<void> | undefined;

function acquireContextLock(clientId: string): Promise<void> {
    if (!contextLockPromise) {
        contextLockPromise = new Promise<void>(resolve => {
            navigator.locks.request(
                clientId,
                () =>
                    new Promise<never>(() => {
                        resolve();
                    }),
            );
        });
    }
    return contextLockPromise;
}

function randomString(): string {
    return Math.random().toString(36).replace("0.", "");
}

interface SharedServiceCallback {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

export class SharedService extends EventTarget {
    #serviceName: string;
    #clientId: Promise<string>;
    #portProviderFunc: () => MessagePort | Promise<MessagePort>;

    // Client channel for messaging — the provider uses a separate BroadcastChannel so
    // instances acting as both client and provider don't interfere.
    #clientChannel = new BroadcastChannel("SharedService");

    #onDeactivate: AbortController | undefined;
    #onClose = new AbortController();

    // Client state for tracking the current provider.
    #providerPort: Promise<MessagePort | null>;
    #providerCallbacks = new Map<string, SharedServiceCallback>();
    #providerCounter = 0;
    #providerChangeCleanup: Array<() => void> = [];

    readonly proxy: Record<string, (...args: Array<unknown>) => Promise<unknown>>;

    constructor(serviceName: string, portProviderFunc: () => MessagePort | Promise<MessagePort>) {
        super();
        this.#serviceName = serviceName;
        this.#portProviderFunc = portProviderFunc;
        this.#clientId = this.#getClientId();
        this.#providerPort = this.#providerChange();
        this.#clientChannel.addEventListener(
            "message",
            ({data}: MessageEvent) => {
                if (data?.type === "provider" && data?.sharedService === this.#serviceName) {
                    // A context (possibly this one) announced itself as the new provider. Discard any
                    // old provider and connect to the new one.
                    this.#closeProviderPort(this.#providerPort);
                    this.#providerPort = this.#providerChange();
                }
            },
            {signal: this.#onClose.signal},
        );
        this.proxy = this.#createProxy();
    }

    activate(): void {
        if (this.#onDeactivate) return;

        // Acquiring a lock on the service name makes this instance the provider. Only one
        // instance at a time holds the lock; the rest wait their turn.
        this.#onDeactivate = new AbortController();
        navigator.locks.request(
            `SharedService-${this.#serviceName}`,
            {signal: this.#onDeactivate.signal},
            async () => {
                // Get the port to request client ports.
                const port = await this.#portProviderFunc();
                port.start();

                // Listen for client requests. A separate BroadcastChannel instance is necessary
                // because we may be serving our own request.
                const providerId = await this.#clientId;
                const broadcastChannel = new BroadcastChannel("SharedService");
                broadcastChannel.addEventListener(
                    "message",
                    async ({data}: MessageEvent) => {
                        if (data?.type === "request" && data?.sharedService === this.#serviceName) {
                            // Get a port to send to the client.
                            const requestedPort = await new Promise<MessagePort>(resolve => {
                                port.addEventListener(
                                    "message",
                                    (event: MessageEvent) => {
                                        resolve(event.ports[0]!);
                                    },
                                    {once: true},
                                );
                                port.postMessage(data.clientId);
                            });
                            this.#sendPortToClient(data, requestedPort);
                        }
                    },
                    {signal: this.#onDeactivate!.signal},
                );

                // Tell everyone that we are the new provider.
                broadcastChannel.postMessage({
                    type: "provider",
                    sharedService: this.#serviceName,
                    providerId,
                });

                // Release the lock only on user abort or context destruction.
                return new Promise<never>((_, reject) => {
                    this.#onDeactivate!.signal.addEventListener("abort", () => {
                        broadcastChannel.close();
                        reject(this.#onDeactivate!.signal.reason);
                    });
                });
            },
        );
    }

    deactivate(): void {
        this.#onDeactivate?.abort();
        this.#onDeactivate = undefined;
    }

    close(): void {
        this.deactivate();
        this.#onClose.abort();
        for (const {reject} of this.#providerCallbacks.values()) {
            reject(new AbortedError("SharedService closed"));
        }
    }

    #sendPortToClient(message: unknown, port: MessagePort): void {
        sharedWorker!.port.postMessage(message, [port]);
    }

    async #getClientId(): Promise<string> {
        // Use a Web Lock to determine our clientId.
        const nonce = Math.random().toString();
        const id = await navigator.locks.request(nonce, async (): Promise<string> => {
            const {held} = await navigator.locks.query();
            return held!.find(lock => lock.name === nonce)!.clientId!;
        });

        // Acquire a Web Lock named after the clientId. This lets other contexts track this
        // context's lifetime.
        await acquireContextLock(id);

        // Configure message forwarding via the SharedWorker. This must be done after
        // acquiring the clientId lock to avoid a race condition in the SharedWorker.
        sharedWorker!.port.addEventListener("message", (event: MessageEvent) => {
            event.data.ports = event.ports;
            this.dispatchEvent(new MessageEvent("message", {data: event.data}));
        });
        sharedWorker!.port.start();
        sharedWorker!.port.postMessage({clientId: id});

        return id;
    }

    async #providerChange(): Promise<MessagePort | null> {
        // Multiple calls to this function could be in flight at once. If that happens, we
        // only care about the most recent call — the one assigned to this.#providerPort.
        // This counter lets us determine whether this call is still the most recent.
        const counter = ++this.#providerCounter;

        // Obtain a MessagePort from the provider. The request can fail during a provider
        // transition, so retry until successful.
        let port: MessagePort | null | undefined;
        const clientId = await this.#clientId;

        while (!port && counter === this.#providerCounter) {
            // Broadcast a request for the port.
            const nonce = randomString();
            this.#clientChannel.postMessage({
                type: "request",
                nonce,
                sharedService: this.#serviceName,
                clientId,
            });

            // Wait for the provider to respond (via the service worker) or timeout. A timeout
            // can occur if there is no provider to receive the broadcast or if the provider is
            // too busy.
            const portReady = new Promise<MessagePort>(resolve => {
                const abortController = new AbortController();
                this.addEventListener(
                    "message",
                    (event: Event) => {
                        const {data} = event as MessageEvent;
                        if (data?.nonce === nonce) {
                            resolve(data.ports[0]);
                            abortController.abort();
                        }
                    },
                    {signal: abortController.signal},
                );
                this.#providerChangeCleanup.push(() => abortController.abort());
            });

            port = await Promise.race([
                portReady,
                new Promise<null>(resolve =>
                    setTimeout(() => resolve(null), providerRequestTimeout),
                ),
            ]);

            if (!port) {
                // If the request eventually arrives after timeout, close it.
                portReady.then(p => p?.close());
            }
        }

        if (port && counter === this.#providerCounter) {
            // Clean up all earlier attempts to get the provider port.
            for (const cleanup of this.#providerChangeCleanup) cleanup();
            this.#providerChangeCleanup = [];

            // Configure the port.
            port.addEventListener("message", ({data}: MessageEvent) => {
                const callback = this.#providerCallbacks.get(data.nonce);
                if (!data.error) {
                    callback?.resolve(data.result);
                } else {
                    callback?.reject(Object.assign(new UnknownError(""), data.error));
                }
            });
            port.start();
            return port;
        } else {
            // Either there is no port because this request timed out, or the port is already
            // obsolete because a new provider has announced itself.
            port?.close();
            return null;
        }
    }

    #closeProviderPort(portPromise: Promise<MessagePort | null>): void {
        portPromise.then(port => port?.close());
        for (const {reject} of this.#providerCallbacks.values()) {
            reject(new AbortedError("SharedService provider change"));
        }
    }

    #createProxy(): Record<string, (...args: Array<unknown>) => Promise<unknown>> {
        return new Proxy({} as Record<string, (...args: Array<unknown>) => Promise<unknown>>, {
            get: (_target, method: string | symbol) => {
                if (typeof method !== "string") return undefined;
                return async (...args: Array<unknown>): Promise<unknown> => {
                    // Use a nonce to match up requests and responses. This allows responses to arrive
                    // out of order.
                    const nonce = randomString();
                    const port = await this.#providerPort;
                    if (!port) throw new UnavailableError("SharedService: no provider");
                    return new Promise<unknown>((resolve, reject) => {
                        this.#providerCallbacks.set(nonce, {resolve, reject});
                        port.postMessage({nonce, method, args});
                    }).finally(() => {
                        this.#providerCallbacks.delete(nonce);
                    });
                };
            },
        });
    }
}

/**
 * Wrap a target with a MessagePort for proxying.
 */
export function createSharedServicePort(
    target: Record<string, (...args: Array<unknown>) => unknown>,
): MessagePort {
    const {port1: providerPort1, port2: providerPort2} = new MessageChannel();
    providerPort1.addEventListener("message", ({data: clientId}: MessageEvent<string>) => {
        const {port1, port2} = new MessageChannel();

        // The port requester holds a lock while using the channel. When the lock is
        // released by the requester, clean up the port on this side.
        navigator.locks.request(clientId, () => {
            port1.close();
        });

        port1.addEventListener("message", async ({data}: MessageEvent) => {
            const response: Record<string, unknown> = {nonce: data.nonce};
            try {
                response.result = await target[data.method]!(...data.args);
            } catch (e) {
                // Error is not structured-cloneable so copy into a plain object.
                response.error =
                    e instanceof Error
                        ? Object.fromEntries(
                              Object.getOwnPropertyNames(e).map(k => [
                                  k,
                                  (e as unknown as Record<string, unknown>)[k],
                              ]),
                          )
                        : e;
            }
            port1.postMessage(response);
        });
        port1.start();
        providerPort1.postMessage(null, [port2]);
    });
    providerPort1.start();
    return providerPort2;
}
