import fs from "fs-extra";
import {extname, join as joinPath} from "path";
import {getRouteIdsWithDefinedShimmerForTest} from "~/client/shimmer/route_shimmer.js";

test("every space route has a shimmer", async () => {
    const workspacePath = process.cwd();
    const routesPath = joinPath(workspacePath, "app/routes");

    const routePaths = (await fs.readdir(routesPath)).filter(route => !route.endsWith(".map"));

    const spaceRouteIds = routePaths
        .map(routePath => `routes/${routePath.slice(0, -extname(routePath).length)}`)
        .filter(
            routeId =>
                routeId.startsWith("routes/s.$spaceId.") &&
                !routeId.startsWith("routes/s.$spaceId.peek"),
        );

    // Sanity check: Make sure we found some routes.
    expect(spaceRouteIds.length).toBeGreaterThan(0);

    expect(spaceRouteIds.sort()).toEqual(getRouteIdsWithDefinedShimmerForTest().sort());
});
