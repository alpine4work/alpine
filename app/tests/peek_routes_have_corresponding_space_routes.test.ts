import fs from "fs-extra";
import {join as joinPath} from "path";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

// Increase test timeout since it might take a while to import all our routes.
// Especially during a big test run in CI.
import.meta.jest.setTimeout(1000 * 60);

const originalBeforeEach = globalThis.beforeEach;
const originalAfterEach = globalThis.afterEach;
const originalBeforeAll = globalThis.beforeAll;
const originalAfterAll = globalThis.afterAll;

beforeEach(() => {
    // When dynamically importing modules in a test we can't be registering
    // before/after hooks.
    (globalThis as any).beforeEach = undefined;
    (globalThis as any).afterEach = undefined;
    (globalThis as any).beforeAll = undefined;
    (globalThis as any).afterAll = undefined;
});

afterEach(() => {
    globalThis.beforeEach = originalBeforeEach;
    globalThis.afterEach = originalAfterEach;
    globalThis.beforeAll = originalBeforeAll;
    globalThis.afterAll = originalAfterAll;
});

test("every peek route has a corresponding space route and exports the same things the space route exports", async () => {
    const workspacePath = process.cwd();
    const routesPath = joinPath(workspacePath, "app/routes");

    const routes = (await fs.readdir(routesPath)).filter(route => !route.endsWith(".map"));

    const peekRoutes = routes.filter(
        route => route.startsWith("_space.peek.") && route !== "_space.peek.js",
    );

    // Make sure we have the right directory by verifying there is at least one peek
    // route.
    expect(peekRoutes.length > 0).toEqual(true);

    peekRoutes.sort();

    const actual = Object.fromEntries(
        await runAllPromises(
            peekRoutes.map(async peekRoute => {
                // NOTE(calebmer): If you update this route ID normalization logic, look for other
                // places that normalize route IDs. Like
                // `makeSpaceDataRouteReuseInflightRequest()`.
                let spacePath: string | null = joinPath(
                    routesPath,
                    peekRoute.replace(".peek.", "."),
                );
                if (!(await fs.pathExists(spacePath))) {
                    spacePath = null;
                }

                const spaceModule = spacePath ? await import(spacePath) : null;

                return [
                    peekRoute,
                    spaceModule
                        ? {
                              // The peek module loader function must be exactly equal to the space module loader
                              // function. This way we can use the data between the two interchangeably.
                              loader: spaceModule.loader,
                              exportNames: Object.keys(spaceModule).sort(),
                          }
                        : null,
                ];
            }),
        ),
    );

    const expected = Object.fromEntries(
        await runAllPromises(
            peekRoutes.map(async peekRoute => {
                const peekModule = await import(joinPath(routesPath, peekRoute));

                return [
                    peekRoute,
                    {
                        // The peek module loader function must be exactly equal to the space module loader
                        // function. This way we can use the data between the two interchangeably.
                        loader: peekModule.loader,
                        exportNames: Object.keys(peekModule).sort(),
                    },
                ];
            }),
        ),
    );

    expect(actual).toEqual(expected);
});
