import "~/server/helpers/node/register_noop_react_refresh.js";

import fs from "fs/promises";
import {join as joinPath, resolve as resolvePath} from "path";
import {chromium, devices} from "playwright";
import {uploadDemoSpaceBotAvatar} from "~/admin/environment/demo_space/upload_demo_space_bot_avatar.js";
import {withIntegrationTestEnvironment} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {createLandingPageScenario} from "~/admin/scenarios/landing_page_scenario.js";
import {seedTestMockChatGptBot} from "~/server/bots/seed_test_bots.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

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
            debug("Seeding database");

            const [admin] = await runAllPromises([
                (async () => {
                    const account = await TestAccount.create(context, {
                        name: "Admin",
                        hasInternalAccess: true,
                    });

                    return await TestSession.create(account);
                })(),
                seedTestMockChatGptBot(context, {
                    agentServiceLocalPort: services.getAgentServicePort(),
                    mockChatGptLocalUnscopedApiKey:
                        await services.getMockChatGptLocalUnscopedApiKey(),
                }),
            ]);

            await uploadDemoSpaceBotAvatar(
                services.getAppServiceTokenAgent(),
                admin,
                getDynamoSeedConstants().mockChatGptBotId,
                "chatGpt",
            );

            debug("Initializing scenario");

            const {cassCade, screenshots} = await createLandingPageScenario(context, {
                tokenAgent: services.getAppServiceTokenAgent(),
            });

            debug("Launching Playwright browser");

            const isDebugging = screenshots.some(screenshot => !!screenshot.debug);
            const hasOnly = screenshots.some(screenshot => !!screenshot.only);

            const browser = await chromium.launch({
                headless: !isDebugging,
            });

            const browserContext = await browser.newContext({
                ...devices["Desktop Chrome"],
                // Take screenshots as if they were on a retina display.
                //
                // The reason this isn't higher (e.g. 3) is because we optimize file image resizing
                // for DPI 2 max on desktop and DPI 3 max on mobile. Our file resizer doesn't
                // currently support sizes you'd need on higher DPIs than 2 for desktop. So for any
                // images we display in screenshots we don't want them upscaled just to be
                // downscaled again (may create weird looking artifacts).
                deviceScaleFactor: 2,
            });

            try {
                for (const screenshot of screenshots) {
                    // Skip any screenshots with `skip` set.
                    if (screenshot.skip) continue;

                    // If one of the screenshots has `only` set then only take that one screenshot.
                    if (hasOnly && !screenshot.only) continue;

                    // If we're debugging one of the screenshots then skip all screenshots that don't
                    // have the `debug` property.
                    if (isDebugging && !screenshot.debug) continue;

                    debug(quote`Taking screenshot: ${screenshot.name}`);

                    await services.signIn(browserContext, screenshot.session ?? cassCade);

                    const page = await browserContext.newPage();

                    try {
                        // Turn off spell checking for screenshots.
                        await page.addInitScript(
                            // eslint-disable-next-line cyberworlds/string-quotes
                            "window.localStorage.setItem('disableSpellCheck', 'true')",
                        );

                        if (screenshot.initScript) {
                            await page.addInitScript(screenshot.initScript);
                        }

                        await page.setViewportSize({
                            width: screenshot.viewport.width,
                            height: screenshot.viewport.height,
                        });

                        await page.goto(`${services.getBaseUrl()}${screenshot.path}`);

                        // Waits for our JavaScript to run and React to finish its initial render.
                        // eslint-disable-next-line cyberworlds/string-quotes
                        await page.waitForFunction("typeof dev !== 'undefined' && dev.ready");

                        await screenshot.prepare?.(page);

                        await page.screenshot({
                            path: joinPath(outputPath, `${screenshot.name}.png`),
                            clip: screenshot.clip,
                        });

                        // If `wait` is set then we run with `headless: false` so the user can inspect the
                        // browser for this screenshot.
                        if (screenshot.debug) {
                            await new Promise(() => {});
                        }
                    } finally {
                        await page.close();
                    }
                }
            } finally {
                debug("Closing Playwright browser");

                await browserContext.close();
                await browser.close();
            }
        },
    );
}

main().then(
    () => {
        // Immediately exit once `main()` finishes. Don't wait for any pending timeouts
        // keeping the process alive. `withDevContext()` will wait for all `waitUntil()`
        // calls to complete before resolving.
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);

        // Immediately exit once `main()` finishes. Don't wait for any pending timeouts
        // keeping the process alive. `withDevContext()` will wait for all `waitUntil()`
        // calls to complete before resolving.
        process.exit(1);
    },
);
