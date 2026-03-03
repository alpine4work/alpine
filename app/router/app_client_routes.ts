import {createClientRoutes, loadRouteModuleWithBlockingLinks} from "@remix-run/react";
import jsonStableStringify from "json-stable-stringify";
import {DataRouteObject, LazyRouteFunction} from "react-router";
import {RootErrorBoundary} from "~/app/router/root_error_boundary.js";
import {createLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {processLoaderResult} from "~/client/web/remix/process_loader_result.js";
import {SpaceRouteErrorBoundary} from "~/client/web/spaces/layout/space_route_error_boundary.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {
    ErrorBase,
    FailedPreconditionError,
    UnavailableError,
    getErrorCode,
} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {assertId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {offlineErrorDisplayMessage} from "~/shared/tracer/fetch_with_tracer.js";

type CreateClientRoutesArgs = Parameters<typeof createClientRoutes>;

/**
 * Create the `react-router` [route tree][1] for our app. This is based on Remix's
 * logic for creating the route tree but then we add some modifications as
 * necessary.
 *
 * This creates the route tree for client rendering. `app_server_routes.ts` creates
 * the route tree for server rendering.
 *
 * [1]: https://reactrouter.com/en/main/route/route
 */
export function createAppClientRoutes(
    manifest: CreateClientRoutesArgs[0],
    routeModulesCache: CreateClientRoutesArgs[1],
    initialState: CreateClientRoutesArgs[2],
    future: CreateClientRoutesArgs[3],
    isSpaMode: CreateClientRoutesArgs[4],
    parentId?: CreateClientRoutesArgs[5],
    routesByParentId?: CreateClientRoutesArgs[6],
    needsRevalidation?: CreateClientRoutesArgs[7],
) {
    const routes = createClientRoutes(
        manifest,
        routeModulesCache,
        initialState,
        future,
        isSpaMode,
        parentId,
        routesByParentId,
        needsRevalidation,
    );

    updateAppClientRoutes(routes);
    return routes;
}

export function createAppClientRoutesWithHmrRevalidationOptOut(
    needsRevalidation: Set<string>,
    manifest: CreateClientRoutesArgs[0],
    routeModulesCache: CreateClientRoutesArgs[1],
    initialState: CreateClientRoutesArgs[2],
    future: CreateClientRoutesArgs[3],
    isSpaMode: CreateClientRoutesArgs[4],
) {
    const routes = createClientRoutes(
        manifest,
        routeModulesCache,
        initialState,
        future,
        isSpaMode,
        undefined,
        undefined,
        needsRevalidation,
    );

    updateAppClientRoutes(routes);
    return routes;
}

function updateAppClientRoutes(routes: Array<DataRouteObject>) {
    const routeById = new Map<string, DataRouteObject>();
    const inflightResponsePromiseByRequestKey = new Map<string, Promise<unknown>>();

    let hasUpdatedRoot = false;
    let hasUpdatedSpaceLayoutDataRoute = false;
    let hasUpdatedSpacePeekLayoutDataRoute = false;
    let hasUpdatedSpaceDataRoute = false;
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
        makeDataRouteThrowUnavailableError(route);

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

        if (route.id === "root") {
            // Don't add a loader timeout for our root.
            hasUpdatedRoot = true;

            // Make sure all route children of `root.tsx` have the same error boundary. This is
            // so we don't have to add an `ErrorBoundary` export to each route file.
            //
            // We need to implement the same thing in `app_server_routes.ts` so we have the
            // same error boundary when server rendering.
            for (const childRoute of route.children ?? []) {
                if (childRoute.Component && !childRoute.ErrorBoundary) {
                    assert(!childRoute.hasErrorBoundary);
                    assert(!childRoute.ErrorBoundary);
                    assert(!childRoute.errorElement);

                    childRoute.hasErrorBoundary = true;
                    childRoute.ErrorBoundary = RootErrorBoundary;
                }
            }
        } else if (route.id === "routes/s.$spaceId") {
            // Don't add a loader timeout for our space layout route. The space layout route
            // will conditionally render `<Outlet>`s based on whether they're done loading or
            // not.
            hasUpdatedSpaceLayoutDataRoute = true;

            // Make sure all route children of `routes/s.$spaceId.tsx` have the same error
            // boundary. This is so we don't have to add an `ErrorBoundary` export to each
            // space route file.
            //
            // We need to implement the same thing in `app_server_routes.ts` so we have the
            // same error boundary when server rendering.
            for (const childRoute of route.children ?? []) {
                if (childRoute.Component && !childRoute.ErrorBoundary) {
                    assert(!childRoute.hasErrorBoundary);
                    assert(!childRoute.ErrorBoundary);
                    assert(!childRoute.errorElement);

                    childRoute.hasErrorBoundary = true;
                    childRoute.ErrorBoundary = SpaceRouteErrorBoundary;
                }
            }
        } else if (route.id === "routes/s.$spaceId.peek") {
            // Don't add a loader timeout for our peek route. The peek layout route will
            // conditionally render `<Outlet>`s based on whether they're done loading or not.
            hasUpdatedSpacePeekLayoutDataRoute = true;
        } else if (route.id.startsWith("routes/s.$spaceId.")) {
            hasUpdatedSpaceDataRoute = true;

            // The ordering here is important. Inflight request reuse handling should be BEFORE
            // our loading indicator handling since if a request takes 5s we want to be able to
            // reuse the request for all 5s. However request reuse handling should be AFTER our
            // task/inbox route updates since they may do extra data processing which should
            // only happen once when a request is reused.
            makeSpaceDataRouteReuseInflightRequest(route, inflightResponsePromiseByRequestKey);

            makeSpaceDataRouteShowLoadingIndicator(route);
        }

        makeLazyDataRouteSelfUpdating(route);
    }

    // Sanity check: Make sure our route updates were applied.
    assert(hasUpdatedRoot);
    assert(hasUpdatedSpaceLayoutDataRoute);
    assert(hasUpdatedSpacePeekLayoutDataRoute);
    assert(hasUpdatedSpaceDataRoute);
    assert(hasUpdatedInboxDataRoute);
    assert(hasUpdatedTaskDataRoute);
    assert(hasUpdatedPeekTaskDataRoute);

    return routes;
}

/**
 * Make sure all asynchronous methods of the route (`loader`, `action`, and `lazy`)
 * throw an `UnavailableError` (or `FailedPreconditionError` if the user is offline
 * therefore the error is not a system error) if an error is thrown.
 *
 * Since Remix makes HTTP requests for these functions under the hood. Our custom
 * function `fetchWithTracer()` automatically treats errors this way but since
 * Remix dispatches its own network requests, errors are not identified.
 */
function makeDataRouteThrowUnavailableError(route: DataRouteObject) {
    if (typeof route.loader === "function") {
        const originalRouteLoader = route.loader;

        route.loader = async (...args) => {
            try {
                const result = await originalRouteLoader(...args);
                return result;
            } catch (error) {
                // If this is using the Remix throw-Response convention then don't convert to an
                // `UnavailableError`.
                if (error instanceof Response) throw error;

                // If the error already has a code, we don't need to add a new one.
                if (error instanceof ErrorBase || getErrorCode(error) !== ErrorCode.Unknown)
                    throw error;

                // NOTE(ifitzsimmons, #ignore-aborted-requests): We want to allow browser-created
                // abort errors to pass through so that we can make the distinction between a
                // request that was aborted by the browser vs. a request that failed due to a
                // process that was aborted by the server while serving the request (i.e. a process
                // times out and we send an Abort signal to cancel ongoing processes). If the
                // client (browser) sent the Abort, we should never show an error on the client.
                if (error instanceof Error && error.name === "AbortError") {
                    throw error;
                }

                // Classify network errors as the `Unavailable` status code.
                //
                // If the user is offline then we use a `FailedPreconditionError` since it's a user
                // error (no internet connection) not a system error. System errors show a red
                // error icon.
                throw (!navigator.onLine ? FailedPreconditionError : UnavailableError).from(
                    error,
                    undefined,
                    {
                        displayMessage:
                            // If we're in a web browser, if we failed to make a request it's probably the
                            // user's internet connection and they should look into a fix.
                            typeof window !== "undefined" && !navigator.onLine
                                ? offlineErrorDisplayMessage
                                : undefined,
                    },
                );
            }
        };
    }

    if (typeof route.action === "function") {
        const originalRouteAction = route.action;

        route.action = async (...args) => {
            try {
                const result = await originalRouteAction(...args);
                return result;
            } catch (error) {
                // If this is using the Remix throw-Response convention then don't convert to an
                // `UnavailableError`.
                if (error instanceof Response) throw error;

                // If the error already has a code, we don't need to add a new one.
                if (error instanceof ErrorBase || getErrorCode(error) !== ErrorCode.Unknown)
                    throw error;

                // Classify network errors as the `Unavailable` status code.
                //
                // If the user is offline then we use a `FailedPreconditionError` since it's a user
                // error (no internet connection) not a system error. System errors show a red
                // error icon.
                throw (!navigator.onLine ? FailedPreconditionError : UnavailableError).from(
                    error,
                    undefined,
                    {
                        displayMessage:
                            // If we're in a web browser, if we failed to make a request it's probably the
                            // user's internet connection and they should look into a fix.
                            typeof window !== "undefined" && !navigator.onLine
                                ? offlineErrorDisplayMessage
                                : undefined,
                    },
                );
            }
        };
    }

    if (typeof route.lazy === "function") {
        const originalRouteLazy = route.lazy;

        route.lazy = async (...args) => {
            try {
                const result = await originalRouteLazy(...args);
                return result;
            } catch (error) {
                // If this is using the Remix throw-Response convention then don't convert to an
                // `UnavailableError`.
                if (error instanceof Response) throw error;

                // If the error already has a code, we don't need to add a new one.
                if (error instanceof ErrorBase || getErrorCode(error) !== ErrorCode.Unknown)
                    throw error;

                // Classify network errors as the `Unavailable` status code.
                //
                // If the user is offline then we use a `FailedPreconditionError` since it's a user
                // error (no internet connection) not a system error. System errors show a red
                // error icon.
                throw (!navigator.onLine ? FailedPreconditionError : UnavailableError).from(
                    error,
                    undefined,
                    {
                        displayMessage:
                            // If we're in a web browser, if we failed to make a request it's probably the
                            // user's internet connection and they should look into a fix.
                            typeof window !== "undefined" && !navigator.onLine
                                ? offlineErrorDisplayMessage
                                : undefined,
                    },
                );
            }
        };
    }
}

/**
 * When navigating to the inbox route, we need to load some extra routes from
 * `peekData` besides what Remix already knows to load. Modify the inbox route so
 * that once the server loader returns data we call the lazy function for those
 * routes to make sure we load their code before the loader resolves.
 *
 * We don't use Remix's `clientLoader` feature since that forces us to load the
 * route code _before_ we can execute the server loader. This creates a network
 * waterfall which slows down the rendering of the inbox route.
 *
 * Remember this loader doesn't run on initial render! Look around for
 * `__remixLoadExtraRouteIds` to see how we load routes on the initial render.
 */
function updateInboxDataRoute(route: DataRouteObject, routeById: Map<string, DataRouteObject>) {
    assert(typeof route.loader === "function");

    const originalRouteLoader = route.loader;

    route.loader = async (...args) => {
        const [result, spaceRouteModule] = await runAllPromises([
            originalRouteLoader(...args),
            spaceRouteModulePromise.get(),
        ]);
        assert(result instanceof Response);

        const data = await processLoaderResult(result);

        // When rendering a task route, we first need to call
        // `clientLoaderTaskStoreLoaderData()`. Detect task routes loaded as nested routes
        // within `/inbox` and make sure to call `clientLoaderTaskStoreLoaderData()` for
        // their loader data.
        //
        // Otherwise if you open a notification peek from the inbox overlay then press the
        // "Open in inbox" button you get an error.
        if (
            isObject(data) &&
            isObject(data.peekData) &&
            isObject(data.peekData.hydrationData) &&
            isObject(data.peekData.hydrationData.loaderData)
        ) {
            for (const [routeId, peekData] of Object.entries(
                data.peekData.hydrationData.loaderData,
            )) {
                if (
                    routeId.startsWith("routes/s.$spaceId.tasks.") ||
                    routeId.startsWith("routes/s.$spaceId.peek.tasks.")
                ) {
                    const spaceId = assertId<SpaceId>(args[0].params.spaceId ?? "");
                    assert(
                        spaceRouteModule.Component &&
                            "clientLoaderTaskStoreLoaderData" in spaceRouteModule.Component &&
                            typeof spaceRouteModule.Component.clientLoaderTaskStoreLoaderData ===
                                "function",
                    );
                    spaceRouteModule.Component.clientLoaderTaskStoreLoaderData(spaceId, peekData);
                }
            }
        }

        if (
            isObject(data) &&
            isObject(data.peekData) &&
            Array.isArray(data.peekData.loadExtraRouteIds)
        ) {
            // Load any extra modules we need for opening the inbox.
            //
            // This will create a request waterfall, unfortunately. If `selected` is in search
            // params we should be able to load route modules in parallel with the original
            // loader. Should implement that someday?
            //
            // On initial request we `modulepreload` the relevant modules so we don't need a
            // request waterfall.
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
 * All task routes must call `clientLoaderTaskStoreLoaderData()` before rendering
 * to integrate task data into our `TaskClientStore`. We do this by updating the
 * `@remix-run/router` object for task routes. After the loader finishes executing
 * we call `clientLoaderTaskStoreLoaderData()`.
 *
 * We don't use Remix's `clientLoader` feature since that forces us to load the
 * route code _before_ we can execute the server loader. This creates a network
 * waterfall which slows down the rendering of task routes. Instead, the function
 * we need to call should be available in the `s.$spaceId.tsx` bundle. So import
 * that route module (which should be cached) and call the function from there.
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

        // In case there's no loader immediately return null. There's no data to process!
        if (result === null) return null;

        assert(result instanceof Response);

        const data = await processLoaderResult(result);

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
 * This is an optimization. If you open the search modal and double click on a
 * result we will start loading the peek on the first click then start navigating
 * the full screen on the second click. We don't want to send two network requests
 * for the same data! So instead, while a `loader` is running if another `loader`
 * for the same `routeId` (peek `routeId`s are normalized), `params`, and
 * `url.search` is called we'll reuse the inflight promise for both `loader` calls.
 *
 * Again, this only happens if a second `loader` request is made BEFORE an
 * identical `loader` request finishes.
 *
 * This optimization relies on the fact that peeks have the exact same loader
 * function as their complementary full route version. We have a test to guarantee
 * that this is the case in
 * `app/tests/peek_routes_have_corresponding_space_routes.test.ts`.
 */
function makeSpaceDataRouteReuseInflightRequest(
    route: DataRouteObject,
    inflightResponsePromiseByRequestKey: Map<string, Promise<unknown>>,
) {
    assert(typeof route.loader === "function");

    const originalRouteLoader = route.loader;
    const normalizedRouteId = route.id.replace(".peek.", ".");

    route.loader = (...args) => {
        const requestKey = jsonStableStringify([
            normalizedRouteId,
            args[0].params,
            new URL(args[0].request.url).search,
        ]);

        const getLoaderDataForRoute = () => {
            const responsePromise = Promise.resolve(originalRouteLoader(...args))
                // We need to process the loader result so if we reuse this request we don't end up
                // parsing the `Response` body twice.
                .then(processLoaderResult);

            return responsePromise.finally(() =>
                inflightResponsePromiseByRequestKey.delete(requestKey),
            );
        };

        const maybeReusedRoutePromise = inflightResponsePromiseByRequestKey.get(requestKey);
        if (maybeReusedRoutePromise) {
            return maybeReusedRoutePromise.catch(error => {
                // NOTE(ifitzsimmons, #ignore-aborted-requests): An error name of "AbortError"
                // indicates that this error was created by the browser (we use "Aborted" for our
                // AbortedError class). We want to listen specifically for AbortErrors from the
                // browser, since that indicates the client cancelled a request.
                //
                // For instance, if you double click on a search entity, the application will send
                // two routing requests (realistically, you should avoid this up front by not
                // sending the second request if the first request is pending). Remix will abort
                // the first request. Since the second request re-uses the first one, we need to
                // allow the second request to proceed.
                if (error instanceof Error && error.name === "AbortError") {
                    const requestPromise = getLoaderDataForRoute();
                    inflightResponsePromiseByRequestKey.set(requestKey, requestPromise);
                    return requestPromise;
                } else {
                    throw error;
                }
            });
        }

        return getOrSetDefaultMapValue(
            inflightResponsePromiseByRequestKey,
            requestKey,
            getLoaderDataForRoute,
        );
    };
}

const makeSpaceDataRouteShowLoadingIndicatorSymbol = Symbol(
    "makeSpaceDataRouteShowLoadingIndicator",
);

/**
 * When navigating within a space, if the network request to load data is taking a
 * long time (maybe some backend system is slow) we want to navigate to the new
 * route but show a fullscreen loading spinner while waiting on data.
 *
 * To accomplish this we modify the Remix route object's client loader function for
 * routes under `/s/:spaceId` to wait at most
 * `delayScreenTransitionLoadingIndicatorLimitMs` for the server loader. If we
 * don't have server data back before then we finish the navigation anyway and
 * depend on `s.$spaceId.tsx` or `s.$spaceId.peek.tsx` to render a fullscreen
 * loading spinner.
 *
 * This is coordinated by "loading indicator loader data". Instead of returning a
 * loader data object, we return an object created by
 * `createLoadingIndicatorLoaderData()` which contains a promise to the loader
 * data. If `s.$spaceId.tsx` sees this as any child route's loader data it'll
 * render a fullscreen loading indicator until the promise has resolved.
 */
function makeSpaceDataRouteShowLoadingIndicator(route: DataRouteObject) {
    // TODO(calebmer): This won't work for routes with a `clientLoader()`. We don't
    // currently have any routes that use `clientLoader()` since the performance is
    // worse than a server loader (client code must be downloaded before data loading
    // can start). However, it shouldn't be too bad to add support for
    // `clientLoader()`. Instead we'd need to update `lazy()` and add our custom
    // timeout support into the loader returned from `lazy()`.
    assert(typeof route.loader === "function");

    const originalRouteLoader = route.loader;

    // TODO(calebmer): I think this also needs to return early for `route.lazy` in case
    // it's taking a long time to download the code bundle. Usually the code bundle is
    // fast to download but on mobile devices that might not be true.
    route.loader = async (...args) => {
        const routeLoaderPromise = originalRouteLoader(...args);

        const result = await Promise.race([
            // Either a promise or the value available synchronously.
            // eslint-disable-next-line @typescript-eslint/await-thenable
            routeLoaderPromise,
            wait(delayScreenTransitionLoadingIndicatorLimitMs).then(
                (): typeof makeSpaceDataRouteShowLoadingIndicatorSymbol =>
                    makeSpaceDataRouteShowLoadingIndicatorSymbol,
            ),
        ]);

        if (result !== makeSpaceDataRouteShowLoadingIndicatorSymbol) {
            return result;
        } else {
            return createLoadingIndicatorLoaderData(
                PromiseImmediate.resolve(routeLoaderPromise)
                    // Since `@remix-run/router` won't get a chance to unwrap the response we have to
                    // do it here.
                    .then(processLoaderResult),
            );
        }
    };
}

/**
 * Make it so that when [`route.lazy()`][1] is called on one of the provided data
 * routes, we update the route in-place with lazy loaded options. In normal
 * `react-router` usage this isn't necessary. `@remix-run/router` [calls
 * `loadLazyRouteModule()`][2] which updates the router's internal state.
 *
 * However, in our product we end up creating multiple routers from the same route
 * objects! If we've already loaded a lazy route, we don't want to load it again.
 *
 * Note that if one router (e.g. the peek router) lazily loads a route module it
 * doesn't update the internal route states of other living routers (e.g. the main
 * router). It only matters for routers we construct in the future (e.g. when
 * opening a new peek in inbox).
 *
 * This is important for peek rendering. We want to load lazy route code in
 * parallel with data in `loadInitialPeekDataForClient()`. Once we've successfully
 * loaded route code we construct the new peek router. The new peek router needs to
 * know the route we loaded isn't lazy anymore. Our self updating routes object
 * makes sure this is the case.
 *
 * [1]: https://reactrouter.com/en/main/route/lazy
 * [2]:
 *     https://github.com/remix-run/react-router/blob/7759e8e2912eb69f6dd63b2906490831a2154cfd/packages/router/router.ts#L4065-L4141
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
                    // This property isn't static since it should always be updated based on the route
                    // updates
                    lazyRouteProperty !== "hasErrorBoundary";

                if (isPropertyStaticallyDefined) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        `Route \`${route.id}\` has a static property \`${lazyRouteProperty}\` ` +
                            `defined but its lazy function is also returning a value for this property. ` +
                            `The lazy route property \`${lazyRouteProperty}\` will be ignored.`,
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
