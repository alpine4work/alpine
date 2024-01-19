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
import {StaticHandlerContext} from "react-router-dom/server.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

// NOCOMMIT: Document that we forked this from:
// https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/react-router-dom/server.tsx#L93-L154
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

    const {state} = dataRouterContext.router;

    return (
        <DataRouterContext.Provider value={dataRouterContext}>
            <DataRouterStateContext.Provider value={state}>
                <Router
                    basename={dataRouterContext.basename}
                    location={state.location}
                    navigationType={state.historyAction}
                    navigator={dataRouterContext.navigator}
                    static={dataRouterContext.static}
                >
                    <DataRoutes routes={router.routes} state={state} />
                </Router>
            </DataRouterStateContext.Provider>
        </DataRouterContext.Provider>
    );
}

function DataRoutes({
    routes,
    state,
}: {
    routes: Array<DataRouteObject>;
    state: RouterState;
}): React.ReactElement | null {
    return useRoutesImpl(routes, undefined, state);
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
