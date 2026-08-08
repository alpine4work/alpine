import {Path, createPath} from "@remix-run/router";
import {
    ServerRoute,
    callRouteLoader,
    matchServerRoutes,
    serializeErrors,
} from "@remix-run/server-runtime";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";

/**
 * We have a client version of this too: `loadInitialPeekDataForClient()`.
 */
export async function loadInitialPeekDataForServer(
    context: LoaderContext,
    request: Request,
    peekRoutes: Array<ServerRoute>,
    spacePath: Path,
): Promise<{
    spacePath: Path;
    peekPath: Path;
    hydrationData: {
        loaderData: {[key: string]: unknown};
        errors: {[key: string]: unknown} | null;
    };
    loadExtraRouteIds: Array<string>;
}> {
    const peekPath = convertSpacePathToPeekPath(spacePath);
    if (!peekPath) throw new InvalidArgumentError("Can only open peek for a space route");

    const routeMatches = matchServerRoutes(peekRoutes, peekPath.pathname);
    if (!routeMatches) throw new NotFoundError("Peek route not found");

    const loadExtraRouteIds: Array<string> = [];

    const loaderData: {[key: string]: unknown} = {};
    let errors: {[key: string]: unknown} | null = null;

    await runAllPromises(
        routeMatches.map(async match => {
            if (match.route.id.startsWith("routes/_space.peek")) {
                loadExtraRouteIds.push(match.route.id);
            }

            if (!match.route.module.loader) return null;

            try {
                const result = await callRouteLoader({
                    loadContext: context,
                    loader: match.route.module.loader,
                    params: match.params,
                    request: new Request(new URL(createPath(peekPath), request.url)),
                    routeId: match.route.id,
                    // We add this parameter in a `@remix-run/server-runtime` patch.
                    // @ts-expect-error
                    routes: peekRoutes,
                });

                loaderData[match.route.id] = await processLoaderResult(result);
            } catch (error) {
                // Errors are placed at the nearest error boundary route. Not the match that threw
                // the error's route.
                // https://github.com/remix-run/react-router/blob/f9b3dbd9cbf513366c456b33d95227f42f36da63/packages/router/router.ts#L3893-L3910
                (errors ??= {})[findNearestBoundary(routeMatches, match.route.id).route.id] =
                    await processLoaderResult(error);
            }
        }),
    );

    return {
        spacePath,
        peekPath,
        hydrationData: {loaderData, errors: serializeErrors(errors, process.env.NODE_ENV as any)},
        loadExtraRouteIds,
    };
}

async function processLoaderResult(result: unknown): Promise<unknown> {
    if (!(result instanceof Response)) return result;

    const contentType = result.headers.get("content-type");

    // Derived from:
    // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/router.ts#L3649-L3656
    if (contentType && /\bapplication\/json\b/.test(contentType)) {
        // NOTE(calebmer): If this response was constructed by `json()` then avoid parsing
        // it again which is wasteful.
        const originalData = (result as any)[Symbol.for("remix.response.json")];
        return originalData !== undefined ? originalData : await result.json();
    } else {
        return await result.text();
    }
}

function findNearestBoundary(
    matches: NonNullable<ReturnType<typeof matchServerRoutes>>,
    routeId?: string,
) {
    const eligibleMatches = routeId
        ? matches.slice(0, matches.findIndex(match => match.route.id === routeId) + 1)
        : [...matches];

    return (
        eligibleMatches.reverse().find(match => !!match.route.module.ErrorBoundary) ?? matches[0]!
    );
}
