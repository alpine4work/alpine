import {RemixBrowser} from "@remix-run/react";
import React from "react";
import ReactDom, {hydrateRoot} from "react-dom/client";
import {AppContext, AppContextProvider} from "~/client/context/app_context";
import {ReactContextModule} from "~/client/context/react_context_module";
import {attachDeveloperConsole} from "~/client/helpers/developer_console";
import {ClientRpcContextModule} from "~/client/rpc/client_rpc_context_module";
import {createClientTracer} from "~/client/tracer/client_tracer";
import {Context} from "~/shared/context/context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {ErrorSchema} from "~/shared/error/error_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

const tracer = createClientTracer();

const context: AppContext = Context.new({
    tracer: new TracerContextModule(tracer),
    rpc: new ClientRpcContextModule(),
    react: new ReactContextModule({
        reportRenderedError: error => {
            // Log after a microtask so we don't get the React component trace in the error
            // log. The trace will always point to our error message renderer which
            // isn't useful.
            scheduleMicrotask(() => {
                // Log the error to the console to make the error easier to debug.
                // eslint-disable-next-line no-console
                console.error(error);

                context.tracer.getRoot().logUncaughtException("Rendered error", error);
            });
        },
    }),
});

hydrateRoot(
    document,
    <AppContextProvider value={context}>
        <RemixBrowser />
    </AppContextProvider>,
);

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
