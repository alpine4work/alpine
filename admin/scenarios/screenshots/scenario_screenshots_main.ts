import "~/server/helpers/node/register_noop_react_refresh.js";

import fs from "fs/promises";
import {join as joinPath, resolve as resolvePath} from "path";
import {chromium, devices} from "playwright";
import {withIntegrationTestEnvironment} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {wait} from "~/shared/helpers/async/wait.js";

const debug = createDebug(import.meta.url);

async function main() {
    const outputPathArg = process.argv[2] ?? "";
    if (!outputPathArg) throw new InvalidArgumentError("Output path is required");

    const outputPath = resolvePath(outputPathArg);

    debug("Starting environment");

    await withIntegrationTestEnvironment(
        {
            undeclaredOutputsDirectoryPath: joinPath(outputPath, "environment"),
            createTemporaryDirectoryPath: async () => {
                const temporaryDirectoryPath = joinPath(outputPath, "environment/tmp");
                await fs.mkdir(temporaryDirectoryPath, {recursive: true});
                return temporaryDirectoryPath;
            },
        },
        async (context, services) => {
            debug("Launching Playwright");

            const browser = await chromium.launch();
            const browserContext = await browser.newContext({
                ...devices["Desktop Chrome"],
                // Take screenshots as if they were on a retina display.
                //
                // The reason this isn't higher (e.g. 3) is because we optimize file image
                // resizing for DPI 2 max on desktop and DPI 3 max on mobile. Our file resizer
                // doesn't currently support sizes you'd need on higher DPIs than 2 for
                // desktop. So for any images we display in screenshots we don't want them
                // upscaled just to be downscaled again (may create weird looking artifacts).
                deviceScaleFactor: 2,
            });

            try {
                const page = await browserContext.newPage();

                debug("Opening Alpine");

                await page.goto(services.getBaseUrl());

                await wait(2000);

                debug("Taking screenshots");

                await page.screenshot({path: joinPath(outputPath, "screenshot.png")});
            } finally {
                await browserContext.close();
                await browser.close();
            }
        },
    );
}

main().then(
    () => {
        // Immediately exit once `main()` finishes. Don't wait for any pending timeouts
        // keeping the process alive. `withDevContext()` will wait for all
        // `waitUntil()` calls to complete before resolving.
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);

        // Immediately exit once `main()` finishes. Don't wait for any pending timeouts
        // keeping the process alive. `withDevContext()` will wait for all
        // `waitUntil()` calls to complete before resolving.
        process.exit(1);
    },
);
