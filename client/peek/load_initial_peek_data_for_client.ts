import {Path, matchRoutes} from "@remix-run/router";
import {DataRouteObject} from "react-router";
import {CancelledError, NotFoundError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

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
                const result = await Promise.race([
                    match.route.loader?.({
                        request,
                        params: match.params,
                    }),
                    abortPromiseResolver.promise,
                ]);

                loaderData[match.route.id] = await processLoaderResult(result);
            } catch (error) {
                (errors ??= {})[match.route.id] = await processLoaderResult(error);
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

async function processLoaderResult(result: unknown): Promise<unknown> {
    if (!(result instanceof Response)) return result;

    const contentType = result.headers.get("Content-Type");

    // Derived from:
    // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/router.ts#L3649-L3656
    if (contentType && /\bapplication\/json\b/.test(contentType)) {
        return result.json();
    } else {
        return result.text();
    }
}
