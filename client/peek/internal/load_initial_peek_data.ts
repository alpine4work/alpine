import {matchClientRoutes} from "@remix-run/react/dist/esm/routeMatching";
import {ClientRoute} from "@remix-run/react/dist/esm/routes";
import {Path, To, parsePath} from "history";
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
    const path = typeof to === "string" ? parsePath(to) : to;
    const match = (path.pathname ?? "/").match(/^(\/s\/[a-zA-Z0-9]+\/)(?!peek)(.*)/);
    if (!match) throw new InternalError("Can only open peek for a space route");
    const pathnamePart1 = match[1]!;
    const pathnamePart2 = match[2]!;

    const peekPath: Path = {
        search: "",
        hash: "",
        ...path,
        pathname: `${pathnamePart1}peek/${pathnamePart2}`,
    };

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
