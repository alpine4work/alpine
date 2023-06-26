import {
    ServerRoute,
    callRouteLoader,
    extractData,
    matchServerRoutes,
} from "@remix-run/server-runtime";
import {Path, To, createPath} from "history";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";
import {SchemaSerializedObjectValue} from "~/shared/schema/schema.js";

/**
 * We have a client version of this too: `loadInitialPeekDataForClient()`.
 */
export async function loadInitialPeekDataForServer(
    context: LoaderContext,
    request: Request,
    routes: Array<ServerRoute>,
    spacePath: To,
): Promise<{
    peekPath: Path;
    loaderData: {[key: string]: SchemaSerializedObjectValue};
    loadExtraRouteIds: Array<string>;
}> {
    const peekPath = convertSpacePathToPeekPath(spacePath);
    if (!peekPath) throw new InvalidArgumentError("Can only open peek for a space route");

    const routeMatches = matchServerRoutes(routes, peekPath.pathname);
    if (!routeMatches) throw new NotFoundError("Peek route not found");

    const loadExtraRouteIds: Array<string> = [];

    const results = await runAllPromises(
        routeMatches
            // Only run peek loaders. The `root` loader and `/s/$space_id` loader are run at
            // the root of our app.
            .filter(match => match.route.id.startsWith("routes/s/$space_id/peek"))
            .map(async match => {
                loadExtraRouteIds.push(match.route.id);

                if (!match.route.module.loader) return null;

                const response = await callRouteLoader({
                    loadContext: context,
                    routeId: match.route.id,
                    loader: match.route.module.loader,
                    params: match.params,
                    request: new Request(new URL(createPath(peekPath), request.url)),
                    // We add this parameter in a `@remix-run/server-runtime` patch.
                    // @ts-expect-error
                    routes,
                });

                return [
                    match.route.id,
                    (await extractData(response)) as SchemaSerializedObjectValue,
                ] as const;
            }),
    );

    const loaderData = Object.fromEntries(results.filter(isNonNullable));

    return {
        peekPath,
        loaderData,
        loadExtraRouteIds,
    };
}
