import fs from "fs-extra";
import path from "path";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

test("every peek route has a corresponding space route", async () => {
    const workspacePath = process.cwd();
    const routesPath = path.join(workspacePath, "app/routes");

    const routes = (await fs.readdir(routesPath)).filter(route => !route.endsWith(".map"));

    const peekRoutes = routes.filter(route => route.startsWith("s.$spaceId.peek."));

    // Make sure we have the right directory by verifying there is at least one
    // peek route.
    expect(peekRoutes.length > 0).toEqual(true);

    peekRoutes.sort();

    expect(
        Object.fromEntries(
            await runAllPromises(
                peekRoutes.map(async peekRoute => [
                    peekRoute,
                    (await fs.pathExists(
                        path.join(routesPath, peekRoute.replace(".peek.", ".")),
                    )) ||
                        // Remix route naming convention means you could have a route ending with
                        // `._index.js` for the same route. This isn't a perfect implementation of the
                        // Remix route naming convention but good enough.
                        (await fs.pathExists(
                            path.join(
                                routesPath,
                                peekRoute
                                    .replace(".peek.", ".")
                                    .slice(0, -path.extname(peekRoute).length) +
                                    `._index${path.extname(peekRoute)}`,
                            ),
                        )),
                ]),
            ),
        ),
    ).toEqual(Object.fromEntries(peekRoutes.map(peekRoute => [peekRoute, true])));
});
