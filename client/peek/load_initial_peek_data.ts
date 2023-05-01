import {ClientRoute, matchClientRoutes} from "@remix-run/react";
import {Path, To} from "history";
import {convertSpacePathToPeekPath} from "~/client/peek/peek_path_helpers";
import {InternalError, NotFoundError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";

export async function loadInitialPeekData(
    routes: Array<ClientRoute>,
    to: To,
    signal: AbortSignal,
): Promise<{
    path: Path;
    loaderData: {[key: string]: unknown};
}> {
    const peekPath = convertSpacePathToPeekPath(to);
    if (!peekPath) throw new InternalError("Can only open peek for a space route");

    const routeMatches = matchClientRoutes(routes, peekPath.pathname);
    if (!routeMatches) throw new NotFoundError("Peek route not found");

    const url = new URL(`${peekPath.pathname}${peekPath.search ?? ""}`, window.location.origin);

    const results = await runAllPromises(
        routeMatches
            // Only run peek loaders. The `root` loader and `/s/$space_id` loader are run at
            // the root of our app.
            .filter(match => match.route.id.startsWith("routes/s/$space_id/peek"))
            .map(async match => {
                try {
                    const value = await match.route.loader?.({
                        params: match.params,
                        url,
                        signal,
                    });
                    return {
                        match,
                        value,
                    };
                } catch (error) {
                    return {
                        match,
                        value: error,
                    };
                }
            }),
    );

    const loaderData: {[key: string]: unknown} = {};

    for (const result of results) {
        if (result.value !== undefined) {
            loaderData[result.match.route.id] = result.value;
        }
    }

    return {
        path: peekPath,
        loaderData,
    };
}
