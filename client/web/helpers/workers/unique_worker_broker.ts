/// <reference lib="webworker" />

// SharedWorker entry point for the unique worker broker. All logic lives in
// `createUniqueWorkerBroker`; this file only adapts the SharedWorker events.
import {createUniqueWorkerBroker} from "~/client/web/helpers/workers/create_unique_worker_broker.js";

declare const self: SharedWorkerGlobalScope;

const broker = createUniqueWorkerBroker({
    watchClientGone(clientLockName, onGone) {
        // The tab holds this lock exclusively for its lifetime. A shared request is
        // granted the moment the tab goes away.
        void navigator.locks.request(clientLockName, {mode: "shared"}, async () => {
            onGone();
        });
    },
});

self.addEventListener("connect", event => {
    const port = event.ports[0]!;
    broker.handleConnect({
        postMessage(data, transfer) {
            port.postMessage(data, (transfer ?? []) as Array<Transferable>);
        },
        set onmessage(
            handler: ((event: {data: unknown; ports: ReadonlyArray<unknown>}) => void) | null,
        ) {
            port.onmessage = handler
                ? messageEvent => handler({data: messageEvent.data, ports: messageEvent.ports})
                : null;
        },
        get onmessage() {
            return null;
        },
        start() {
            port.start();
        },
        close() {
            port.close();
        },
    });
});
