import {createClientRoutes, loadRouteModuleWithBlockingLinks} from "@remix-run/react";
import {DataRouteObject, LazyRouteFunction} from "react-router";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {assertId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create the `react-router` [route tree][1] for our app. This is based on
 * Remix's logic for creating the route tree but then we add some modifications
 * as necessary.
 *
 * [1]: https://reactrouter.com/en/main/route/route
 */
export function createAppClientRoutes() {
    const routes = createClientRoutes(
        window.__remixManifest.routes,
        window.__remixRouteModules,
        window.__remixContext.state,
        window.__remixContext.future,
        window.__remixContext.isSpaMode,
    );

    const routeById = new Map<string, DataRouteObject>();

    let hasUpdatedInboxDataRoute = false;
    let hasUpdatedTaskDataRoute = false;
    let hasUpdatedPeekTaskDataRoute = false;

    updateDataRoutesRecursively(routes);

    function updateDataRoutesRecursively(routes: Array<DataRouteObject>) {
        for (const route of routes) {
            routeById.set(route.id, route);
            updateDataRoute(route);

            if (route.children) {
                updateDataRoutesRecursively(route.children);
            }
        }
    }

    function updateDataRoute(route: DataRouteObject) {
        if (route.id === "routes/s.$spaceId.inbox") {
            hasUpdatedInboxDataRoute = true;
            updateInboxDataRoute(route, routeById);
        }

        if (route.id.startsWith("routes/s.$spaceId.tasks.")) {
            hasUpdatedTaskDataRoute = true;
            updateTaskDataRoute(route);
        } else if (route.id.startsWith("routes/s.$spaceId.peek.tasks.")) {
            hasUpdatedPeekTaskDataRoute = true;
            updateTaskDataRoute(route);
        }

        makeLazyDataRouteSelfUpdating(route);
    }

    // Make sure our route updates were applied.
    assert(hasUpdatedInboxDataRoute);
    assert(hasUpdatedTaskDataRoute);
    assert(hasUpdatedPeekTaskDataRoute);

    return routes;
}

/**
 * When navigating to the inbox route, we need to load some extra routes from
 * `peekData` besides what Remix already knows to load. Modify the inbox route
 * so that once the server loader returns data we call the lazy function for
 * those routes to make sure we load their code before the loader resolves.
 *
 * We don't use Remix's `clientLoader` feature since that forces us to load the
 * route code *before* we can execute the server loader. This creates a network
 * waterfall which slows down the rendering of the inbox route.
 *
 * Remember this loader doesn't run on initial render! Look around for
 * `__remixLoadExtraRouteIds` to see how we load routes on the initial render.
 */
function updateInboxDataRoute(route: DataRouteObject, routeById: Map<string, DataRouteObject>) {
    assert(typeof route.loader === "function");

    const originalRouteLoader = route.loader;

    route.loader = async (...args) => {
        const result = await originalRouteLoader(...args);
        assert(result instanceof Response);

        // Implement same unwrapping logic as `@remix-run/router`:
        // https://github.com/remix-run/react-router/blob/4b494b935d62cd1244fe5c091db920d3f0315e9e/packages/router/router.ts#L3764-L3772
        let data: unknown;
        const contentType = result.headers.get("Content-Type");
        // Check between word boundaries instead of startsWith() due to the last
        // paragraph of https://httpwg.org/specs/rfc9110.html#field.content-type
        if (contentType && /\bapplication\/json\b/.test(contentType)) {
            data = await result.json();
        } else {
            data = await result.text();
        }

        if (
            isObject(data) &&
            isObject(data.peekData) &&
            Array.isArray(data.peekData.loadExtraRouteIds)
        ) {
            // Load any extra modules we need for opening the inbox.
            //
            // This will create a request waterfall, unfortunately. If `selected` is in
            // search params we should be able to load route modules in parallel with the
            // original loader. Should implement that someday?
            //
            // On initial request we `modulepreload` the relevant modules so we don't need
            // a request waterfall.
            await runAllPromises(
                data.peekData.loadExtraRouteIds.map(async extraRouteId => {
                    const extraRoute = routeById.get(extraRouteId);
                    assert(extraRoute);
                    await extraRoute.lazy?.();
                }),
            );
        }

        // Headers and status code are lost for task routes.
        return data;
    };
}

const spaceRouteModulePromise = new Lazy(() =>
    loadRouteModuleWithBlockingLinks(
        window.__remixManifest.routes["routes/s.$spaceId"]!,
        window.__remixRouteModules,
    ),
);

/**
 * All task routes must call `clientLoaderTaskStoreLoaderData()` before
 * rendering to integrate task data into our `TaskClientStore`. We do this by
 * updating the `@remix-run/router` object for task routes. After the loader
 * finishes executing we call `clientLoaderTaskStoreLoaderData()`.
 *
 * We don't use Remix's `clientLoader` feature since that forces us to load the
 * route code *before* we can execute the server loader. This creates a network
 * waterfall which slows down the rendering of task routes. Instead, the
 * function we need to call should be available in the `s.$spaceId.tsx` bundle.
 * So import that route module (which should be cached) and call the function
 * from there.
 *
 * Remember this loader doesn't run on initial render!
 */
function updateTaskDataRoute(route: DataRouteObject) {
    assert(typeof route.loader === "function");

    const originalRouteLoader = route.loader;

    route.loader = async (...args) => {
        const [result, spaceRouteModule] = await runAllPromises([
            originalRouteLoader(...args),
            spaceRouteModulePromise.get(),
        ]);
        assert(result instanceof Response);

        // Implement same unwrapping logic as `@remix-run/router`:
        // https://github.com/remix-run/react-router/blob/4b494b935d62cd1244fe5c091db920d3f0315e9e/packages/router/router.ts#L3764-L3772
        let data: unknown;
        const contentType = result.headers.get("Content-Type");
        // Check between word boundaries instead of startsWith() due to the last
        // paragraph of https://httpwg.org/specs/rfc9110.html#field.content-type
        if (contentType && /\bapplication\/json\b/.test(contentType)) {
            data = await result.json();
        } else {
            data = await result.text();
        }

        const spaceId = assertId<SpaceId>(args[0].params.spaceId ?? "");
        assert(
            spaceRouteModule.Component &&
                "clientLoaderTaskStoreLoaderData" in spaceRouteModule.Component &&
                typeof spaceRouteModule.Component.clientLoaderTaskStoreLoaderData === "function",
        );
        spaceRouteModule.Component.clientLoaderTaskStoreLoaderData(spaceId, data);

        // Headers and status code are lost for task routes.
        return data;
    };
}

/**
 * Make it so that when [`route.lazy()`][1] is called on one of the provided
 * data routes, we update the route in-place with lazy loaded options. In
 * normal `react-router` usage this isn't necessary. `@remix-run/router` [calls
 * `loadLazyRouteModule()`][2] which updates the router's internal state.
 *
 * However, in our product we end up creating multiple routers from the same
 * route objects! If we've already loaded a lazy route, we don't want to load
 * it again.
 *
 * Note that if one router (e.g. the peek router) lazily loads a route module
 * it doesn't update the internal route states of other living routers (e.g.
 * the main router). It only matters for routers we construct in the future
 * (e.g. when opening a new peek in inbox).
 *
 * This is important for peek rendering. We want to load lazy route code in
 * parallel with data in `loadInitialPeekDataForClient()`. Once we've
 * successfully loaded route code we construct the new peek router. The new
 * peek router needs to know the route we loaded isn't lazy anymore. Our self
 * updating routes object makes sure this is the case.
 *
 * [1]: https://reactrouter.com/en/main/route/lazy
 * [2]: https://github.com/remix-run/react-router/blob/7759e8e2912eb69f6dd63b2906490831a2154cfd/packages/router/router.ts#L4065-L4141
 */
function makeLazyDataRouteSelfUpdating(route: DataRouteObject) {
    if (!route.lazy) return;
    const originalRouteLazy = route.lazy;

    let lazyRoutePromise: ReturnType<LazyRouteFunction<DataRouteObject>> | null = null;

    route.lazy = () => {
        lazyRoutePromise ??= (async () => {
            const lazyRoute = await originalRouteLazy();

            for (const lazyRouteProperty in lazyRoute) {
                const staticRouteValue = (route as any)[lazyRouteProperty];

                const isPropertyStaticallyDefined =
                    staticRouteValue !== undefined &&
                    // This property isn't static since it should always be updated based
                    // on the route updates
                    lazyRouteProperty !== "hasErrorBoundary";

                if (isPropertyStaticallyDefined) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        `Route "${route.id}" has a static property "${lazyRouteProperty}" ` +
                            `defined but its lazy function is also returning a value for this property. ` +
                            `The lazy route property "${lazyRouteProperty}" will be ignored.`,
                    );
                }

                if (
                    !isPropertyStaticallyDefined &&
                    lazyRouteProperty !== "lazy" &&
                    lazyRouteProperty !== "caseSensitive" &&
                    lazyRouteProperty !== "path" &&
                    lazyRouteProperty !== "id" &&
                    lazyRouteProperty !== "index" &&
                    lazyRouteProperty !== "children"
                ) {
                    (route as any)[lazyRouteProperty] =
                        lazyRoute[lazyRouteProperty as keyof typeof lazyRoute];
                }
            }

            // The route is no longer lazy.
            route.lazy = undefined;

            return lazyRoute;
        })();

        return lazyRoutePromise;
    };
}
