import {startTransition} from "react";
import {hydrateRoot} from "react-dom/client";
import {AppRemixBrowser} from "~/app/router/app_remix_browser.js";
import {AppContext, AppContextProvider} from "~/client/context/app_context.js";
import {ReactContextModule} from "~/client/context/react_context_module.js";
import {installScrollbarAuditorInDev} from "~/client/design/scrollbar.js";
import {attachDevConsoleNotInProduction} from "~/client/dev/dev_console.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {updateNativeMobileThemeColors} from "~/client/remix/update_native_mobile_theme_colors.js";
import {ClientRpcContextModule} from "~/client/rpc/client_rpc_context_module.js";
import {createClientTracer} from "~/client/tracer/client_tracer.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

async function main() {
    // We add a `clientLoader` feature to Remix routes. `clientLoader` functions
    // are called on the client with server loader data. We call `clientLoader` for
    // initial loads here in our code vs in a patch so we can make it async.
    //
    // NOTE(calebmer, 2024-01-17): Looks like since I added a custom
    // `clientLoader`, the Remix team [added their own `clientLoader`][1]! The
    // semantics are a bit different. Ideally we'd use the Remix `clientLoader`.
    //
    // [1]: https://remix.run/docs/en/main/route/client-loader
    const clientLoaderResults = await Promise.allSettled(
        window.__remixContext.matches.map(async (match, i) => {
            const routeModule = window.__remixRouteModules[match.routeId]!;

            // If there was an error from an earlier match, don't run this client loader.
            for (let j = 0; j < i; j++) {
                const earlierMatch = window.__remixContext.matches[j]!;
                if (window.__remixContext.state.errors?.[earlierMatch.routeId]) return;
            }

            const loaderData = window.__remixContext.state.loaderData?.[match.routeId];

            await (routeModule as any).clientLoader?.({data: loaderData, params: match.params});
        }),
    );

    // Check if there was an error in our results and update `__remixContext` as if
    // the error was thrown on the server.
    //
    // If there's a `clientLoader` error then there will be a hydration HTML
    // mismatch! This forces our app into client-side rendering which is fine.
    for (let i = 0; i < clientLoaderResults.length; i++) {
        const clientLoaderResult = clientLoaderResults[i]!;

        if (clientLoaderResult.status === "rejected") {
            for (let j = i; j >= 0; j--) {
                const match = window.__remixContext.matches[j]!;
                const routeModule = window.__remixRouteModules[match.routeId]!;

                if (!routeModule.ErrorBoundary) {
                    if (window.__remixContext.state.loaderData)
                        delete window.__remixContext.state.loaderData[match.routeId];
                } else {
                    (window.__remixContext.state.errors ??= {})[match.routeId] =
                        clientLoaderResult.reason;
                    break;
                }
            }
            break;
        }
    }

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
                    context.tracer.getRoot().logUncaughtException("Rendered error", error);
                });
            },
        }),
    });

    // Don't block the browser's main thread with the initial render.
    startTransition(() => {
        // `isNativeMobile` is a constant throughout our application's lifetime.
        const isNativeMobile =
            typeof window !== "undefined" && getClientInfoWithoutListening().isNativeMobile;

        hydrateRoot(
            document,
            <AppContextProvider value={context}>
                <AppRemixBrowser isNativeMobile={isNativeMobile} />
            </AppContextProvider>,
            {
                onRecoverableError: error => {
                    tracer.logUncaughtException("Recoverable React error", error);
                },
            },
        );

        // Install our scrollbar auditor after React has finished hydrating. (Ideally
        // we'd install after `isInitialAppRender` goes to false.)
        if (process.env.NODE_ENV !== "production") {
            installScrollbarAuditorInDev();
        }
    });

    // Tell native mobile what our theme color is from server rendering.
    updateNativeMobileThemeColors();

    attachDevConsoleNotInProduction();
}

main().catch(scheduleUncaughtError);
