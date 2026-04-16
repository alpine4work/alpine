import * as inquirer from "@inquirer/prompts";
import fs from "fs/promises";
import os from "os";
import {join as joinPath} from "path";
import {Browser, BrowserContext, Page, chromium, devices} from "playwright";
import {
    TestServices,
    withIntegrationTestEnvironment,
} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";
import {PrettyMarkdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export class ScalableDemoRecorder {
    private readonly _services: TestServices;
    private readonly _baseUrl: string;
    private readonly _browser: Browser;
    private readonly _browserContext: BrowserContext;

    constructor({
        services,
        baseUrl,
        browser,
        browserContext,
    }: {
        services: TestServices;
        baseUrl: string;
        browser: Browser;
        browserContext: BrowserContext;
    }) {
        this._baseUrl = baseUrl;
        this._services = services;
        this._browser = browser;
        this._browserContext = browserContext;
    }

    public async record({
        instructions,
        session,
        path,
        viewport,
        prepare,
    }: {
        instructions: PrettyMarkdown;
        session: TestSpaceSession | TestSession | null;
        path: string;
        viewport?: {width: number; height?: number};
        prepare?: (page: Page) => Promise<void>;
    }): Promise<void> {
        if (session !== null) {
            await this._services.signIn(this._browserContext, session);
        } else {
            await this._browserContext.clearCookies();
        }

        const page = await this._browserContext.newPage();

        await page.setViewportSize({
            width: viewport?.width ?? scalableDemoDefaultViewport.width,
            height:
                viewport?.height ??
                (viewport
                    ? Math.round(viewport.width / goldenRatio)
                    : scalableDemoDefaultViewport.height),
        });

        try {
            // Spell check is an alpha feature. Don't show spell check lints.
            await page.addInitScript(
                // eslint-disable-next-line cyberworlds/string-quotes
                "window.localStorage.setItem('disableSpellCheck', 'true')",
            );

            await page.goto(new URL(path, this._baseUrl).toString());

            // Waits for our JavaScript to run and React to finish its initial render.
            // eslint-disable-next-line cyberworlds/string-quotes
            await page.waitForFunction("typeof dev !== 'undefined' && dev.ready");

            await prepare?.(page);

            // eslint-disable-next-line no-console
            console.log();
            // eslint-disable-next-line no-console
            console.log("Instructions:");
            // eslint-disable-next-line no-console
            console.log();
            // eslint-disable-next-line no-console
            console.log(instructions.trim());
            // eslint-disable-next-line no-console
            console.log();

            await inquirer.confirm({message: "Finished recording?"});
        } finally {
            await page.close();
        }
    }
}

export function runScalableDemoRecorder(
    run: (
        context: TestContext,
        services: TestServices,
        recorder: ScalableDemoRecorder,
    ) => Promise<void>,
) {
    async function main() {
        await withTemporaryDirectory(
            os.tmpdir(),
            "cyberworlds_demo_",
            async temporaryDirectoryPath => {
                await withIntegrationTestEnvironment(
                    {
                        undeclaredOutputsDirectoryPath: joinPath(
                            temporaryDirectoryPath,
                            "environment",
                        ),
                        createTemporaryDirectoryPath: async () => {
                            const childTemporaryDirectoryPath = joinPath(
                                temporaryDirectoryPath,
                                "temporary",
                            );

                            await fs.mkdir(childTemporaryDirectoryPath, {recursive: true});

                            return childTemporaryDirectoryPath;
                        },
                    },
                    async (context, services) => {
                        const baseUrl = await services.waitForBaseUrl();

                        const browser = await chromium.launch({
                            headless: false,
                            // Chrome arguments can be found here:
                            //
                            // https://peter.sh/experiments/chromium-command-line-switches
                            args: ["--window-position=0,0"],
                        });

                        const browserContext = await browser.newContext({
                            ...devices["Desktop Chrome"],
                            viewport: scalableDemoDefaultViewport,
                            // Make sure animations are allowed.
                            reducedMotion: "no-preference",
                            // Take screenshots as if they were on a retina display.
                            //
                            // The reason this isn't higher (e.g. 3) is because we optimize file image resizing
                            // for DPI 2 max on desktop and DPI 3 max on mobile. Our file resizer doesn't
                            // currently support sizes you'd need on higher DPIs than 2 for desktop. So for any
                            // images we display in screenshots we don't want them upscaled just to be
                            // downscaled again (may create weird looking artifacts).
                            deviceScaleFactor: 2,
                            timezoneId: "America/New_York",
                        });

                        const recorder = new ScalableDemoRecorder({
                            services,
                            baseUrl,
                            browser,
                            browserContext,
                        });

                        debug("Recorder environment ready");

                        await run(context, services, recorder);
                    },
                );
            },
        );
    }

    main().then(
        () => {
            process.exit(0);
        },
        error => {
            // eslint-disable-next-line no-console
            console.error(error);
            process.exit(1);
        },
    );
}
