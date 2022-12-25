import {RemixBrowser} from "@remix-run/react";
import React from "react";
import ReactDom, {hydrateRoot} from "react-dom/client";
import {attachDeveloperConsole} from "~/client/helpers/developer_console";
import {ErrorSchema} from "~/shared/error/error_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {Tracer} from "~/shared/tracer/tracer";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

const tracer = createTracer();

hydrateRoot(document, <RemixBrowser />);

attachDeveloperConsole();

// Initialize [axe][1] which is an automated accessibility tester.
// Accessibility violations are printed to the console.
//
// [1]: https://github.com/dequelabs/axe-core-npm
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    runPromiseWithoutAwaiting(async () => {
        const {default: axe} = await import("@axe-core/react");

        await axe(React, ReactDom, 1000, {
            rules: [
                // We are building an app with web technology. Apps do not allow users to pinch
                // and zoom in.
                //
                // We can add font scaling options for vision impaired users.
                {
                    id: "meta-viewport",
                    enabled: false,
                },
            ],
        });
    });
}

function createTracer() {
    assert(typeof document !== "undefined");

    const initialDateNow = Date.now();
    const initialPerformanceNow = Math.floor(performance.now());

    return Tracer.new({
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
