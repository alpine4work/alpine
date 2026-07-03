// Test-only `MessageChannel` replacement. Mimics the real MessagePort semantics
// the unique worker system relies on: delivery is asynchronous and ordered,
// messages buffer until the port is started (setting `onmessage` starts it),
// "transferred" ports arrive as `event.ports`, and `close()` fires the peer's
// `close` event. `neuterForTest` silences a port without the close event, like a
// port whose owning context crashed.

type UniqueWorkerTestMessageListener = (event: MessageEvent) => void;

export class UniqueWorkerTestMessagePort {
    private peer!: UniqueWorkerTestMessagePort;
    private started = false;
    private dead = false;
    private drainScheduled = false;
    private readonly buffered: Array<MessageEvent> = [];
    private messageHandler: UniqueWorkerTestMessageListener | null = null;
    private readonly messageListeners = new Set<UniqueWorkerTestMessageListener>();
    private readonly closeListeners = new Set<() => void>();

    get onmessage(): UniqueWorkerTestMessageListener | null {
        return this.messageHandler;
    }

    set onmessage(handler: UniqueWorkerTestMessageListener | null) {
        this.messageHandler = handler;
        this.start();
    }

    start(): void {
        this.started = true;
        this.scheduleDrain();
    }

    postMessage(data: unknown, transfer: ReadonlyArray<Transferable> = []): void {
        if (this.dead) return;
        const event = {data, ports: transfer} as unknown as MessageEvent;
        const peer = this.peer;
        queueMicrotask(() => peer.deliver(event));
    }

    addEventListener(type: "message" | "close", listener: () => void): void {
        // Unlike setting `onmessage`, `addEventListener` does not start the port.
        if (type === "message") {
            this.messageListeners.add(listener as UniqueWorkerTestMessageListener);
        } else {
            this.closeListeners.add(listener);
        }
    }

    removeEventListener(type: "message" | "close", listener: () => void): void {
        if (type === "message") {
            this.messageListeners.delete(listener as UniqueWorkerTestMessageListener);
        } else {
            this.closeListeners.delete(listener);
        }
    }

    close(): void {
        if (this.dead) return;
        this.dead = true;
        const peer = this.peer;
        queueMicrotask(() => peer.dispatchClose());
    }

    /** Silence the port without firing the peer's `close` event. */
    neuterForTest(): void {
        this.dead = true;
    }

    private deliver(event: MessageEvent): void {
        if (this.dead) return;
        this.buffered.push(event);
        this.scheduleDrain();
    }

    private scheduleDrain(): void {
        if (!this.started || this.drainScheduled || this.buffered.length === 0) return;
        this.drainScheduled = true;
        queueMicrotask(() => {
            this.drainScheduled = false;
            while (this.buffered.length > 0 && this.started && !this.dead) {
                const event = this.buffered.shift()!;
                this.messageHandler?.(event);
                for (const listener of this.messageListeners) {
                    listener(event);
                }
            }
        });
    }

    private dispatchClose(): void {
        if (this.dead) return;
        for (const listener of this.closeListeners) {
            listener();
        }
    }

    static createPair(): [UniqueWorkerTestMessagePort, UniqueWorkerTestMessagePort] {
        const port1 = new UniqueWorkerTestMessagePort();
        const port2 = new UniqueWorkerTestMessagePort();
        port1.peer = port2;
        port2.peer = port1;
        return [port1, port2];
    }
}

export class UniqueWorkerTestMessageChannel {
    readonly port1: MessagePort;
    readonly port2: MessagePort;

    constructor() {
        const [port1, port2] = UniqueWorkerTestMessagePort.createPair();
        this.port1 = port1 as unknown as MessagePort;
        this.port2 = port2 as unknown as MessagePort;
    }
}
