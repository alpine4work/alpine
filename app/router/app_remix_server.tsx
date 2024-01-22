import {
    UNSAFE_RemixContext as RemixContext,
    RemixServerProps,
    createServerRoutes,
} from "@remix-run/react";
import {ReactElement} from "react";
import {createStaticRouter} from "react-router-dom/server.js";
import {AppStaticRouterProvider} from "~/app/router/app_static_router_provider.js";

/**
 * This is a fork of the [`<RemixServer>` component in `@remix-run/react`][1].
 *
 * We forked this component to add support for our native mobile router. We've
 * also simplified some some bits we don't need.
 *
 * [1]: https://github.com/remix-run/remix/blob/d8f403490baef9b2814f7c2b984294bf08fc09df/packages/remix-react/server.tsx#L27-L66
 */
export function AppRemixServer({context, url, abortDelay}: RemixServerProps): ReactElement {
    if (typeof url === "string") {
        url = new URL(url);
    }

    const {manifest, routeModules, serverHandoffString} = context;
    const routes = createServerRoutes(manifest.routes, routeModules, context.future);
    const router = createStaticRouter(routes, context.staticHandlerContext);

    return (
        <RemixContext.Provider
            value={{
                manifest,
                routeModules,
                serverHandoffString,
                future: context.future,
                abortDelay,
            }}
        >
            <AppStaticRouterProvider router={router} context={context.staticHandlerContext} />
        </RemixContext.Provider>
    );
}
