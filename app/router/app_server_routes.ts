import {ServerBuild} from "@remix-run/server-runtime";
import {RootErrorBoundary} from "~/app/router/root_error_boundary.js";
import {SpaceRouteErrorBoundary} from "~/client/web/spaces/layout/space_route_error_boundary.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Create the `react-router` [route map][1] for our app. This is based on
 * Remix's logic for creating the route tree but then we add some modifications
 * as necessary.
 *
 * This creates the route tree for server rendering. `app_server_routes.ts`
 * creates the route tree for client rendering.
 *
 * [1]: https://reactrouter.com/en/main/route/route
 */
export function createAppServerRoutes(routes: ServerBuild["routes"]): ServerBuild["routes"] {
    const newRoutes: ServerBuild["routes"] = {};

    let hasUpdatedRoot = false;
    let hasUpdatedSpaceLayoutDataRoute = false;

    for (const [routeId, route] of Object.entries(routes)) {
        let newRoute = route;

        // Make sure all route children of `root.tsx` have the same error boundary.
        // This is so we don't have to add an `ErrorBoundary` export to each
        // route file.
        //
        // We need to implement the same thing in `app_client_routes.ts` so we have the
        // same error boundary when client rendering.
        if (route.parentId === "root") {
            hasUpdatedRoot = true;

            if (route.module.default && !route.module.ErrorBoundary) {
                assert(!route.module.ErrorBoundary);

                newRoute = {
                    ...newRoute,
                    module: {
                        ...newRoute.module,
                        ErrorBoundary: RootErrorBoundary,
                    },
                };
            }
        }

        // Make sure all route children of `routes/s.$spaceId.tsx` have the same error
        // boundary. This is so we don't have to add an `ErrorBoundary` export to each
        // space route file.
        //
        // We need to implement the same thing in `app_client_routes.ts` so we have the
        // same error boundary when client rendering.
        if (route.parentId === "routes/s.$spaceId") {
            hasUpdatedSpaceLayoutDataRoute = true;

            if (route.module.default && !route.module.ErrorBoundary) {
                assert(!route.module.ErrorBoundary);

                newRoute = {
                    ...newRoute,
                    module: {
                        ...newRoute.module,
                        ErrorBoundary: SpaceRouteErrorBoundary,
                    },
                };
            }
        }

        newRoutes[routeId] = newRoute;
    }

    // Sanity check: Make sure our route updates were applied.
    assert(hasUpdatedRoot);
    assert(hasUpdatedSpaceLayoutDataRoute);

    return newRoutes;
}
