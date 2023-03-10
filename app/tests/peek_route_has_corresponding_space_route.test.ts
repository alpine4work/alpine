import fs from "fs-extra";
import path from "path";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";

test("every peek route has a corresponding space route", async () => {
    const workspacePath = process.cwd();
    const routesPath = path.join(workspacePath, "app/routes");
    const spaceRoutesPath = path.join(routesPath, "s/$space_id");
    const peekRoutesPath = path.join(spaceRoutesPath, "peek");

    expect(await fs.pathExists(spaceRoutesPath)).toEqual(true);
    expect(await fs.pathExists(peekRoutesPath)).toEqual(true);

    const peekRouteRelativePaths: Array<string> = [];

    const loop = async (searchPath: string) => {
        if (!(await fs.lstat(searchPath)).isDirectory()) {
            if (!searchPath.endsWith(".map")) {
                peekRouteRelativePaths.push(path.relative(peekRoutesPath, searchPath));
            }
        } else {
            await runAllPromises(
                (await fs.readdir(searchPath)).map(name => loop(path.join(searchPath, name))),
            );
        }
    };

    await loop(peekRoutesPath);

    peekRouteRelativePaths.sort();

    expect(
        Object.fromEntries(
            await runAllPromises(
                peekRouteRelativePaths.map(async peekRouteRelativePath => [
                    peekRouteRelativePath,
                    (await fs.pathExists(path.join(spaceRoutesPath, peekRouteRelativePath))) ||
                        // Remix route naming convention means you could have a folder with an
                        // `index.js` for the same route. This isn't a perfect implementation of the
                        // Remix route naming convention but good enough.
                        (await fs.pathExists(
                            path.join(
                                spaceRoutesPath,
                                peekRouteRelativePath.slice(
                                    0,
                                    -path.extname(peekRouteRelativePath).length,
                                ),
                                `index${path.extname(peekRouteRelativePath)}`,
                            ),
                        )),
                ]),
            ),
        ),
    ).toEqual(
        Object.fromEntries(
            peekRouteRelativePaths.map(peekRouteRelativePath => [peekRouteRelativePath, true]),
        ),
    );
});
