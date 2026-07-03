/// <reference lib="webworker" />

// SharedWorker entry point for the unique worker broker. All logic lives in
// `createUniqueWorkerBroker`; this file only wires up the connect events.
import {createUniqueWorkerBroker} from "~/client/web/helpers/workers/create_unique_worker_broker.js";

declare const self: SharedWorkerGlobalScope;

const broker = createUniqueWorkerBroker();

self.addEventListener("connect", event => {
    broker.handleConnect(event.ports[0]!);
});
