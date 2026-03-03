import {Router as RemixRouter, RouterState} from "@remix-run/router";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    Path,
    Router,
    To,
    createPath,
    parsePath,
    UNSAFE_useRoutesImpl as useRoutesImpl,
} from "react-router";
import {UNSAFE_FetchersContext as FetchersContext} from "react-router-dom";
import {StaticHandlerContext} from "react-router-dom/server.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * This is a fork of the [`<StaticRouterProvider>` component in `react-router`][1].
 *
 * We forked this component to add support for our native mobile router. We've also
 * simplified some some bits we don't need.
 *
 * [1]:
 *     https://github.com/remix-run/react-router/blob/7759e8e2912eb69f6dd63b2906490831a2154cfd/packages/react-router-dom/server.tsx#L96-L174
 */
export function AppStaticRouterProvider({
    context,
    router,
}: {
    context: StaticHandlerContext;
    router: RemixRouter;
}) {
    assert(router && context, "You must provide `router` and `context` to <StaticRouterProvider>");

    const dataRouterContext = {
        router,
        navigator: getStatelessNavigator(),
        static: true,
        staticContext: context,
        basename: context.basename || "/",
    };

    const fetchersContext = new Map();

    const {state} = dataRouterContext.router;

    return (
        <DataRouterContext.Provider value={dataRouterContext}>
            <DataRouterStateContext.Provider value={state}>
                <FetchersContext.Provider value={fetchersContext}>
                    <Router
                        basename={dataRouterContext.basename}
                        location={state.location}
                        navigationType={state.historyAction}
                        navigator={dataRouterContext.navigator}
                        static={dataRouterContext.static}
                    >
                        <DataRoutes routes={router.routes} future={router.future} state={state} />
                    </Router>
                </FetchersContext.Provider>
            </DataRouterStateContext.Provider>
        </DataRouterContext.Provider>
    );
}

function DataRoutes({
    routes,
    future,
    state,
}: {
    routes: Array<DataRouteObject>;
    future: RemixRouter["future"];
    state: RouterState;
}): React.ReactElement | null {
    return useRoutesImpl(routes, undefined, state, future);
}

function createHref(to: To) {
    return typeof to === "string" ? to : createPath(to);
}

function encodeLocation(to: To): Path {
    // Locations should already be encoded on the server, so just return as-is
    const path = typeof to === "string" ? parsePath(to) : to;
    return {
        pathname: path.pathname || "",
        search: path.search || "",
        hash: path.hash || "",
    };
}

function getStatelessNavigator() {
    return {
        createHref,
        encodeLocation,
        push(to: To) {
            throw new InternalError(
                `You cannot use navigator.push() on the server because it is a stateless ` +
                    `environment. This error was probably triggered when you did a ` +
                    `\`navigate(${JSON.stringify(to)})\` somewhere in your app.`,
            );
        },
        replace(to: To) {
            throw new InternalError(
                `You cannot use navigator.replace() on the server because it is a stateless ` +
                    `environment. This error was probably triggered when you did a ` +
                    `\`navigate(${JSON.stringify(to)}, { replace: true })\` somewhere ` +
                    `in your app.`,
            );
        },
        go(delta: number) {
            throw new InternalError(
                `You cannot use navigator.go() on the server because it is a stateless ` +
                    `environment. This error was probably triggered when you did a ` +
                    `\`navigate(${delta})\` somewhere in your app.`,
            );
        },
        back() {
            throw new InternalError(
                `You cannot use navigator.back() on the server because it is a stateless ` +
                    `environment.`,
            );
        },
        forward() {
            throw new InternalError(
                `You cannot use navigator.forward() on the server because it is a stateless ` +
                    `environment.`,
            );
        },
    };
}
