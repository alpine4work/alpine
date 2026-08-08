import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";

// This file should only run in a Node.js test environment. Either Jest or
// Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV !== "production");

export const testTracer = TracerRoot.new({
    serviceName: "Test",
    jsHost: "Node",
    untrusted: false,
    clock: unsynchronizedSystemClock,
    sendEvent: () => {
        // The test tracer ignores all events. We should consider adding a flag or
        // environment variable that enables tracer logging for debugging.
        //
        // Calling `writeTracerEventToFileInDev()` would pollute the local log file with
        // repetitive events on each run that likely aren't as useful as logs from the
        // developer's `dev` server. It definitely wouldn't be useful in CI where
        // developers don't have access to the tracer log directory which doesn't end up in
        // `bazel-testlogs`. We wouldn't want to log into a file that ends up in
        // `bazel-testlogs` anyway in CI since that would create huge artifacts we'd have
        // to pay storage costs for.
    },
});
