import {RemixBrowser} from "@remix-run/react";
import {RouteModule} from "@remix-run/react/dist/routeModules";
import {startTransition} from "react";
import {hydrateRoot} from "react-dom/client";
import {AppContext, AppContextProvider} from "~/client/context/app_context";
import {ReactContextModule} from "~/client/context/react_context_module";
import {attachDevConsoleNotInProduction} from "~/client/dev/dev_console";
import {ClientRpcContextModule} from "~/client/rpc/client_rpc_context_module";
import {createClientTracer} from "~/client/tracer/client_tracer";
import {Context} from "~/shared/context/context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {ErrorSchema} from "~/shared/error/error_schema";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

function main() {
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

    // Don't block the browser's main thread with the initial render.
    startTransition(() => {
        hydrateRoot(
            document,
            <AppContextProvider value={context}>
                <RemixBrowser />
            </AppContextProvider>,
            {
                onRecoverableError: error => {
                    tracer.logUncaughtException("Recoverable React error", error);
                },
            },
        );
    });

    attachDevConsoleNotInProduction();
}

const extraRemixRouteModules: Array<{id: string; modulePromise: Promise<RouteModule>}> | undefined =
    (window as any).__extraRemixRouteModules;

// If there was a `<script>` that injected some extra route modules, wait for
// them to load and put them in our route modules object before hydrating
// the app.
if (!extraRemixRouteModules) {
    main();
} else {
    Promise.allSettled(
        extraRemixRouteModules.map(async routeModule => {
            window.__remixRouteModules[routeModule.id] = await routeModule.modulePromise;
        }),
    ).finally(main);
}
