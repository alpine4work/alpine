import {
    UniqueWorkerBroker,
    createUniqueWorkerBroker,
} from "~/client/web/helpers/workers/create_unique_worker_broker.js";
import {UniqueWorkerTestLockManager} from "~/client/web/helpers/workers/test_helpers/unique_worker_test_lock_manager.js";
import {
    UniqueWorkerTestMessageChannel,
    UniqueWorkerTestMessagePort,
} from "~/client/web/helpers/workers/test_helpers/unique_worker_test_message_channel.js";
import {InternalError} from "~/shared/error/error.open_source.js";

/** The in-process body of a fake dedicated worker. */
export interface UniqueWorkerTestWorkerScript {
    handleMessage(data: unknown, ports: ReadonlyArray<MessagePort>): void;
}

export interface UniqueWorkerTestMocks {
    /**
     * Provides the in-process implementation behind `new Worker(url)`. The factory
     * receives the URL the production code passed, so tests can vary the script per
     * worker.
     */
    setWorkerScriptFactory(factory: (url: string) => UniqueWorkerTestWorkerScript): void;
    /**
     * Force-release a held Web Lock, as the browser does when the holding tab dies.
     * Releasing a key's election lock (see `uniqueWorkerWebLockName`) simulates a
     * leader tab crash: the next queued client is granted the lock and promotes
     * itself. Note the "crashed" client's objects aren't torn down — they linger like
     * any unreferenced zombie, which real tests can ignore.
     */
    forceReleaseWebLock(name: string): void;
}

/**
 * Replaces `navigator.locks`, `MessageChannel`, `Worker`, and `SharedWorker` with
 * in-process fakes so the unique worker system runs unmodified under Jest. The
 * `SharedWorker` fake hosts the real broker logic; only the dedicated worker's
 * script needs to be provided via {@link
 * UniqueWorkerTestMocks.setWorkerScriptFactory}.
 *
 * Call once per test — each call installs fresh, isolated state.
 */
export function installUniqueWorkerTestMocks(): UniqueWorkerTestMocks {
    const locks = new UniqueWorkerTestLockManager();
    Object.defineProperty(globalThis.navigator, "locks", {
        value: locks as unknown as LockManager,
        configurable: true,
    });

    (globalThis as Record<string, unknown>).MessageChannel = UniqueWorkerTestMessageChannel;

    let workerScriptFactory: ((url: string) => UniqueWorkerTestWorkerScript) | null = null;

    class UniqueWorkerTestWorker {
        onerror: ((event: ErrorEvent) => void) | null = null;
        private readonly script: UniqueWorkerTestWorkerScript;
        private readonly transferredPorts: Array<UniqueWorkerTestMessagePort> = [];
        private terminated = false;

        constructor(url: string | URL) {
            if (workerScriptFactory === null) {
                throw new InternalError(
                    "installUniqueWorkerTestMocks: call setWorkerScriptFactory before the code under test creates workers",
                );
            }
            this.script = workerScriptFactory(String(url));
        }

        postMessage(data: unknown, transfer: ReadonlyArray<Transferable> = []): void {
            if (this.terminated) return;
            const ports = transfer as unknown as Array<UniqueWorkerTestMessagePort>;
            this.transferredPorts.push(...ports);
            queueMicrotask(() => {
                if (this.terminated) return;
                try {
                    this.script.handleMessage(data, ports as unknown as Array<MessagePort>);
                } catch (error) {
                    // Real dedicated workers report uncaught errors via the parent's `onerror`.
                    this.onerror?.({
                        message: error instanceof Error ? error.message : String(error),
                        error,
                    } as unknown as ErrorEvent);
                }
            });
        }

        terminate(): void {
            this.terminated = true;
            for (const port of this.transferredPorts) {
                port.neuterForTest();
            }
        }
    }
    (globalThis as Record<string, unknown>).Worker = UniqueWorkerTestWorker;

    // One broker per install, lazily started and running the real broker logic (which
    // uses the mocked `navigator.locks` for client liveness).
    let broker: UniqueWorkerBroker | null = null;
    class UniqueWorkerTestSharedWorker {
        readonly port: MessagePort;

        constructor() {
            if (broker === null) {
                broker = createUniqueWorkerBroker();
            }
            const channel = new UniqueWorkerTestMessageChannel();
            broker.handleConnect(channel.port2);
            this.port = channel.port1;
        }
    }
    (globalThis as Record<string, unknown>).SharedWorker = UniqueWorkerTestSharedWorker;

    return {
        setWorkerScriptFactory(factory) {
            workerScriptFactory = factory;
        },
        forceReleaseWebLock(name) {
            locks.forceRelease(name);
        },
    };
}
