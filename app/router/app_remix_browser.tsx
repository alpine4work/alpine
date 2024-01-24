import {
    RemixBrowserProps,
    UNSAFE_RemixContext as RemixContext,
    createClientRoutes,
    deserializeErrors,
} from "@remix-run/react";
import {Router} from "@remix-run/router";
import {ReactElement} from "react";
import {createBrowserRouter} from "react-router-dom";
import {AppRouterProvider} from "~/app/router/app_router_provider.js";
import {createNativeMobileRouter} from "~/app/router/native_mobile_router.js";

let router: Router | undefined;

/**
 * This is a fork of the [`<RemixBrowser>` component in `@remix-run/react`][1].
 *
 * We forked this component to add support for our native mobile router. We've
 * also simplified some some bits we don't need.
 *
 * [1]: https://github.com/remix-run/remix/blob/d8f403490baef9b2814f7c2b984294bf08fc09df/packages/remix-react/browser.tsx#L150-L234
 */
export function AppRemixBrowser({
    isNativeMobile,
}: RemixBrowserProps & {isNativeMobile: boolean}): ReactElement {
    if (!router) {
        const routes = createClientRoutes(
            window.__remixManifest.routes,
            window.__remixRouteModules,
            window.__remixContext.future,
        );

        let hydrationData = window.__remixContext.state;
        if (hydrationData && hydrationData.errors) {
            hydrationData = {
                ...hydrationData,
                errors: deserializeErrors(hydrationData.errors),
            };
        }

        router = (isNativeMobile ? createNativeMobileRouter : createBrowserRouter)(routes, {
            hydrationData,
            future: {
                // Pass through the Remix future flag to avoid a v1 breaking change in
                // useNavigation() - users can control the casing via the flag in v1.
                // useFetcher still always uppercases in the back-compat layer in v1.
                // In v2 we can just always pass true here and remove the back-compat
                // layer
                v7_normalizeFormMethod: window.__remixContext.future.v2_normalizeFormMethod,
            },
        });

        // Hard reload if the URL we tried to load is not the current URL.
        // This is usually the result of 2 rapid backwards/forward clicks from an
        // external site into a Remix app, where we initially start the load for
        // one URL and while the JS chunks are loading a second forward click moves
        // us to a new URL
        const initialUrl = window.__remixContext.url;
        const hydratedUrl = window.location.pathname + window.location.search;
        if (initialUrl !== hydratedUrl) {
            const errorMessage =
                `Initial URL (${initialUrl}) does not match URL at time of hydration ` +
                `(${hydratedUrl}), reloading page...`;
            // eslint-disable-next-line no-console
            console.error(errorMessage);
            window.location.reload();
        }
    }

    return (
        <RemixContext.Provider
            value={{
                manifest: window.__remixManifest,
                routeModules: window.__remixRouteModules,
                future: window.__remixContext.future,
            }}
        >
            <AppRouterProvider
                router={router}
                fallbackElement={null}
                future={{v7_startTransition: true}}
            />
        </RemixContext.Provider>
    );
}
