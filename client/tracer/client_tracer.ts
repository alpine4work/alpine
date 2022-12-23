import {assert} from "~/shared/helpers/control/assert";
import {Tracer} from "~/shared/tracer/tracer";

let globalClientTracer: Tracer | undefined;

/**
 * Get the tracer object for our client code running in a web browser. Throws
 * if we are running on the server and not in a web browser.
 *
 * The client tracer is a global, shared, object since there is one JavaScript
 * process per user on the client.
 */
export function getGlobalClientTracer(): Tracer {
    assert(typeof document !== "undefined");
    if (!globalClientTracer) globalClientTracer = createClientTracer();
    return globalClientTracer;
}

function createClientTracer() {
    assert(typeof document !== "undefined");

    const initialDateNow = Date.now();
    const initialPerformanceNow = Math.floor(performance.now());

    return new Tracer({
        serviceName: "AppClient",
        jsHost: "Web",
        getTime: () => {
            // We use `performance.now()` for measuring time on the client since it is a
            // monotonically increasing clock designed for measuring performance.
            //
            // The user may change their system clock which would give `Date.now()` weird
            // inconsistent values whereas `performance.now()` (to our knowledge) should
            // only move forward.
            //
            // We capture the initial time from `Date.now()` so we get a timestamp since
            // the Unix epoch instead of the window origin.
            return initialDateNow + (Math.floor(performance.now()) - initialPerformanceNow);
        },
    });
}
