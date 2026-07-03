import {assert} from "~/shared/helpers/control/assert.js";

// this file is intended to be run as a shared worker.
declare const self: SharedWorkerGlobalScope;

self.addEventListener("connect", event => {
    const port = event.ports[0];
    assert(port);

    port.onmessage = event => {};
});
