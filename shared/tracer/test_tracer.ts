import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {writeTracerEventToFileInDev} from "~/shared/tracer/write_tracer_event_to_file_in_dev.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export const testTracer = TracerRoot.new({
    serviceName: "Test",
    jsHost: "Node",
    untrusted: false,
    clock: unsynchronizedSystemClock,
    // Don't send events from tests to Honeycomb. That feels like too much. But do
    // write events to our dev files. This can help developers debug.
    sendEvent: writeTracerEventToFileInDev,
});
