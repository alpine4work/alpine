import {loadRouteModuleWithBlockingLinks} from "@remix-run/react";
import {startTransition} from "react";
import {hydrateRoot} from "react-dom/client";
import {AppRemixBrowser} from "~/app/router/app_remix_browser.js";
import {AppContext, AppContextProvider} from "~/client/context/app_context.js";
import {ReactContextModule} from "~/client/context/react_context_module.js";
import {registerAlwaysClearSelectionOnMouseDown} from "~/client/design/register_always_clear_selection_on_mouse_down.js";
import {installScrollbarAuditorInDev} from "~/client/design/scrollbar.js";
import {attachDevConsoleNotInProduction} from "~/client/dev/dev_console.js";
import {subscribeToColorSchemeChange} from "~/client/helpers/color_scheme.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {updateNativeMobileThemeColors} from "~/client/remix/update_native_mobile_theme_colors.js";
import {ClientRpcContextModule} from "~/client/rpc/client_rpc_context_module.js";
import {createClientTracer} from "~/client/tracer/client_tracer.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Schema} from "~/shared/schema/schema.js";

declare global {
    // eslint-disable-next-line no-var
    var __remixErrorSchema: Schema<any> | undefined;
    // eslint-disable-next-line no-var
    var __remixLoadExtraRouteIds: Array<string> | undefined;
}

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
globalThis.__remixErrorSchema = ErrorSchema;

async function main() {
    registerAlwaysClearSelectionOnMouseDown();

    // Used by `s.$spaceId.inbox.tsx` to load routes rendered in the peek before
    // React hydration starts (which will need the route module code).
    if (window.__remixLoadExtraRouteIds) {
        await runAllPromises(
            window.__remixLoadExtraRouteIds.map(routeId =>
                loadRouteModuleWithBlockingLinks(
                    window.__remixManifest.routes[routeId]!,
                    window.__remixRouteModules,
                ),
            ),
        );
    }

    const tracer = createClientTracer();

    const context: AppContext = Context.new({
        tracer: new TracerContextModule(tracer),
        rpc: new ClientRpcContextModule(),
        react: ReactContextModule.newForClient(),
    });

    // Don't block the browser's main thread with the initial render.
    startTransition(() => {
        // `isNativeMobile` is a constant throughout our application's lifetime.
        const isNativeMobile = typeof window !== "undefined" && getClientInfo().isNativeMobile;

        hydrateRoot(
            document,
            <AppContextProvider value={context}>
                <AppRemixBrowser isNativeMobile={isNativeMobile} />
            </AppContextProvider>,
            {
                onRecoverableError: error => {
                    tracer.logException("Recoverable React error", error);
                },
            },
        );

        // Install our scrollbar auditor after React has finished hydrating. (Ideally
        // we'd install after `isInitialAppRender` goes to false.)
        if (process.env.NODE_ENV !== "production") {
            installScrollbarAuditorInDev();
        }
    });

    // Tell native mobile what our theme color is after server rendering. Update
    // the theme color whenever the color scheme changes.
    updateNativeMobileThemeColors();
    subscribeToColorSchemeChange(updateNativeMobileThemeColors);

    attachDevConsoleNotInProduction();
}

main().catch(scheduleUncaughtError);
