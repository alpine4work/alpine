import {AgnosticRouteMatch, Path, matchRoutes} from "@remix-run/router";
import {DataRouteObject} from "react-router";
import {processLoaderResult} from "~/client/remix/process_loader_result.js";
import {CancelledError, NotFoundError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * We have a server version of this too: `loadInitialPeekDataForServer()`.
 */
// NOTE(calebmer): This probably doesn't support a wide range of Remix features
// including redirects and deferred data. But it supports enough for our
// critical path.
export async function loadInitialPeekDataForClient(
    peekRoutes: ReadonlyArray<DataRouteObject>,
    path: Path,
    signal: AbortSignal,
): Promise<{
    loaderData: {[key: string]: unknown};
    errors: {[key: string]: unknown} | null;
}> {
    const routeMatches = matchRoutes(peekRoutes as Array<DataRouteObject>, path.pathname);
    if (!routeMatches) throw new NotFoundError("Route not found");

    const url = new URL(`${path.pathname}${path.search ?? ""}`, window.location.origin);
    const request = new Request(url, {signal});

    const loaderData: {[key: string]: unknown} = {};
    let errors: {[key: string]: unknown} | null = null;

    await runAllPromises(
        routeMatches.map(async match => {
            const abortPromiseResolver = createPromiseResolver<never>();
            const handleAbort = () =>
                abortPromiseResolver.reject(new CancelledError("Route loader aborted"));
            request.signal.addEventListener("abort", handleAbort);

            try {
                const shouldCallLazy = match.route.id.startsWith("routes/s.$spaceId.peek");

                const [result] = await Promise.race([
                    // eslint-disable-next-line @typescript-eslint/await-thenable
                    await runAllPromises([
                        typeof match.route.loader === "function"
                            ? match.route.loader({
                                  request,
                                  params: match.params,
                              })
                            : undefined,
                        // Make sure we load modules for any matches we'll need to render with this
                        // peek. On the server we add modules we need to load to an `loadExtraRouteIds`
                        // array.
                        shouldCallLazy && match.route.lazy ? match.route.lazy() : undefined,
                    ]),
                    abortPromiseResolver.promise,
                ]);

                // We expect the `lazy` function to update the route object with the loaded
                // component data. That way when we create a router for this route it doesn't
                // need to load the route again. Remix does not do this out of the box. Look
                // for our `makeLazyDataRouteSelfUpdating()` function which overrides the
                // `lazy` function.
                if (shouldCallLazy) {
                    assert(match.route.lazy === undefined);
                }

                loaderData[match.route.id] = await processLoaderResult(result);
            } catch (error) {
                // Errors are placed at the nearest error boundary route. Not the match that
                // threw the error's route.
                // https://github.com/remix-run/react-router/blob/f9b3dbd9cbf513366c456b33d95227f42f36da63/packages/router/router.ts#L3893-L3910
                (errors ??= {})[findNearestBoundary(routeMatches, match.route.id).route.id] =
                    await processLoaderResult(error);
            } finally {
                request.signal.removeEventListener("abort", handleAbort);
            }
        }),
    );

    return {
        loaderData,
        errors,
    };
}

function findNearestBoundary(
    matches: Array<AgnosticRouteMatch<string, DataRouteObject>>,
    routeId?: string,
): AgnosticRouteMatch<string, DataRouteObject> {
    const eligibleMatches = routeId
        ? matches.slice(0, matches.findIndex(match => match.route.id === routeId) + 1)
        : [...matches];

    return (
        eligibleMatches.reverse().find(match => match.route.hasErrorBoundary === true) ??
        matches[0]!
    );
}
