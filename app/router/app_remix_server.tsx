import {
    UNSAFE_RemixContext as RemixContext,
    RemixServerProps,
    createServerRoutes,
    shouldHydrateRouteLoader,
} from "@remix-run/react";
import {ReactElement} from "react";
import {createStaticRouter} from "react-router-dom/server.js";
import {AppStaticRouterProvider} from "~/app/router/app_static_router_provider.js";
import {createNativeMobileStaticRouter} from "~/app/router/native_mobile_router.js";

/**
 * This is a fork of the [`<RemixServer>` component in `@remix-run/react`][1].
 *
 * We forked this component to add support for our native mobile router. We've also
 * simplified some some bits we don't need.
 *
 * [1]:
 *     https://github.com/remix-run/remix/blob/a94303c7f812fdb9118d8dad065837c4a825efb8/packages/remix-react/server.tsx#L21-L112
 */
export function AppRemixServer({
    context,
    url,
    abortDelay,
    isNativeMobile,
}: RemixServerProps & {isNativeMobile: boolean}): ReactElement {
    if (typeof url === "string") {
        url = new URL(url);
    }

    const {manifest, routeModules, criticalCss, serverHandoffString} = context;
    const routes = createServerRoutes(
        manifest.routes,
        routeModules,
        context.future,
        context.isSpaMode,
    );

    // Create a shallow clone of `loaderData` we can mutate for partial hydration.
    // When a route exports a `clientLoader` and a `HydrateFallback`, we want to
    // render the fallback on the server so we clear our the `loaderData` during SSR.
    // Is it important not to change the `context` reference here since we use it
    // for context._deepestRenderedBoundaryId tracking
    //
    // eslint-disable-next-line react-compiler/react-compiler
    context.staticHandlerContext.loaderData = {
        ...context.staticHandlerContext.loaderData,
    };
    for (const match of context.staticHandlerContext.matches) {
        const routeId = match.route.id;
        const route = routeModules[routeId];
        const manifestRoute = context.manifest.routes[routeId];
        // Clear out the loaderData to avoid rendering the route component when the route
        // opted into clientLoader hydration and either:
        //
        // - gave us a HydrateFallback
        // - or doesn't have a server loader and we have no data to render
        if (
            route &&
            shouldHydrateRouteLoader(manifestRoute!, route, context.isSpaMode) &&
            (route.HydrateFallback || !manifestRoute!.hasLoader)
        ) {
            context.staticHandlerContext.loaderData[routeId] = undefined;
        }
    }

    const router = (isNativeMobile ? createNativeMobileStaticRouter : createStaticRouter)(
        routes,
        context.staticHandlerContext,
        {
            future: {
                v7_partialHydration: true,
                v7_relativeSplatPath: context.future.v3_relativeSplatPath,
            },
        },
    );

    return (
        <RemixContext.Provider
            value={{
                manifest,
                routeModules,
                criticalCss,
                serverHandoffString,
                future: context.future,
                isSpaMode: context.isSpaMode,
                // eslint-disable-next-line @typescript-eslint/unbound-method
                serializeError: context.serializeError,
                abortDelay,
                renderMeta: context.renderMeta,
                // @ts-expect-error: This doesn't exist in the Remix TypeScript types.
                originalRoutesForPeek: routes,
            }}
        >
            <AppStaticRouterProvider router={router} context={context.staticHandlerContext} />
        </RemixContext.Provider>
    );
}
