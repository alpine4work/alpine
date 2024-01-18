import {RouterState} from "@remix-run/router";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    Path,
    Router,
    To,
    createPath,
    isRouteErrorResponse,
    parsePath,
    UNSAFE_useRoutesImpl as useRoutesImpl,
} from "react-router";
import {StaticHandlerContext, StaticRouterProviderProps} from "react-router-dom/server.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

// NOCOMMIT: Document that we forked this from:
// https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/react-router-dom/server.tsx#L93-L154
export function AppStaticRouterProvider({
    context,
    router,
    hydrate = true,
    nonce,
}: StaticRouterProviderProps) {
    assert(router && context, "You must provide `router` and `context` to <StaticRouterProvider>");

    const dataRouterContext = {
        router,
        navigator: getStatelessNavigator(),
        static: true,
        staticContext: context,
        basename: context.basename || "/",
    };

    let hydrateScript = "";

    if (hydrate !== false) {
        const data = {
            loaderData: context.loaderData,
            actionData: context.actionData,
            errors: serializeErrors(context.errors),
        };
        // Use JSON.parse here instead of embedding a raw JS object here to speed
        // up parsing on the client. Dual-stringify is needed to ensure all quotes
        // are properly escaped in the resulting string. See:
        // https://v8.dev/blog/cost-of-javascript-2019#json
        const json = htmlEscape(JSON.stringify(JSON.stringify(data)));
        hydrateScript = `window.__staticRouterHydrationData = JSON.parse(${json});`;
    }

    const {state} = dataRouterContext.router;

    return (
        <>
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
            {hydrateScript ? (
                <script
                    suppressHydrationWarning
                    nonce={nonce}
                    dangerouslySetInnerHTML={{__html: hydrateScript}}
                />
            ) : null}
        </>
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

function serializeErrors(errors: StaticHandlerContext["errors"]): StaticHandlerContext["errors"] {
    if (!errors) return null;
    const entries = Object.entries(errors);
    const serialized: StaticHandlerContext["errors"] = {};
    for (const [key, val] of entries) {
        // Hey you! If you change this, please change the corresponding logic in
        // deserializeErrors in react-router-dom/index.tsx :)
        if (isRouteErrorResponse(val)) {
            serialized[key] = {...val, __type: "RouteErrorResponse"};
        } else if (val instanceof Error) {
            // Do not serialize stack traces from SSR for security reasons
            serialized[key] = {
                message: val.message,
                __type: "Error",
            };
        } else {
            serialized[key] = val;
        }
    }
    return serialized;
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

// This utility is based on https://github.com/zertosh/htmlescape
// License: https://github.com/zertosh/htmlescape/blob/0527ca7156a524d256101bb310a9f970f63078ad/LICENSE
const ESCAPE_LOOKUP: {[match: string]: string} = {
    "&": "\\u0026",
    ">": "\\u003e",
    "<": "\\u003c",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
};

const ESCAPE_REGEX = /[&><\u2028\u2029]/g;

function htmlEscape(str: string): string {
    return str.replace(ESCAPE_REGEX, match => ESCAPE_LOOKUP[match]!);
}
