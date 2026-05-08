import fs from "fs/promises";
import looksSame from "looks-same";
import os from "os";
import {basename, join as joinPath} from "path";
import {BrowserContext, Locator, Mouse, Page, chromium, devices} from "playwright";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {
    TestServices,
    withIntegrationTestEnvironment,
} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {createDevEnvPaths} from "~/admin/helpers/create_dev_env_paths.js";
import {parseDotenvForNodeEnv} from "~/admin/helpers/parse_dotenv.js";
import {screenshotTestLooksSameTolerance} from "~/app/screenshot_tests/helpers/screenshot_test_looks_same_tolerance.js";
import {screenshotTestEndTime} from "~/app/screenshot_tests/helpers/screenshot_test_time.js";
import {scrollbarStyles} from "~/client/web/styles/styles.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {encodeOrderKey} from "~/shared/helpers/sort/encode_order_key.js";
import {OrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {quote} from "~/shared/helpers/string/quote.js";

const debug = createDebug(import.meta.url);

const defaultViewport = {width: 1366, height: 1024};

type ScreenshotTestSession = TestSession | TestSpaceSession | null;

export type ScreenshotTestMode = "compare" | "update" | "preview";

export function parseScreenshotTestMode(mode: string | undefined): ScreenshotTestMode {
    if (mode === "compare") return "compare";
    if (mode === "update") return "update";
    if (mode === "preview") return "preview";

    throw new InvalidArgumentError(quote`Unknown screenshot test mode: ${mode}`);
}

export type ScreenshotTestDefinition = {
    testName: string;
    run: (context: TestActualContext, runner: ScreenshotTestRunner) => Promise<void>;
};

class ScreenshotRunner {
    public readonly testName: string;
    public readonly stableRandom: StableRandom;

    readonly #mode: ScreenshotTestMode;
    readonly #baseUrl: string;
    readonly #browserContext: BrowserContext;
    readonly #services: TestServices;
    readonly #outputDirectoryPath: string;

    #page: Page | null = null;
    #screenshotNames = new Set<string>();
    #lastScreenshotOrderKey: OrderKey | null = null;
    #screenshotFileNames = new Set<string>();
    #hasCreatedDemoSpace = false;

    constructor({
        testName,
        mode,
        baseUrl,
        browserContext,
        services,
        outputDirectoryPath,
    }: {
        testName: string;
        mode: ScreenshotTestMode;
        baseUrl: string;
        browserContext: BrowserContext;
        services: TestServices;
        outputDirectoryPath: string;
    }) {
        this.testName = testName;
        this.stableRandom = new StableRandom(`${this.testName}_screenshot_test`);
        this.#mode = mode;
        this.#baseUrl = baseUrl;
        this.#browserContext = browserContext;
        this.#services = services;
        this.#outputDirectoryPath = outputDirectoryPath;
    }

    get services(): TestServices {
        return this.#services;
    }

    createDemoSpace(context: TestContext) {
        // Can only create one demo space because we use `stableRandom` to generate stable
        // `Id`s across screenshot test runs. The means there's only one possible `SpaceId`
        // for each test runner.
        //
        // By using stable random `Id`s any non-determinism based on the `SpaceId` or
        // `AccountId` doesn't change across screenshot test runs. (e.g. Direct `ChatId`s
        // which influences the order of accounts in the chat search entity preview via
        // `sortSearchDirectChatEntityAccountIds()`.)
        assert(!this.#hasCreatedDemoSpace);
        this.#hasCreatedDemoSpace = true;

        return createDemoSpace(context, this.#services.getAppServiceTokenAgent(), {
            stableRandom: this.stableRandom,
        });
    }

    get page(): Page {
        return this.#requirePage();
    }

    get mouse(): Mouse {
        return this.#requirePage().mouse;
    }

    getByRole(...args: Parameters<Page["getByRole"]>): Locator {
        return this.#requirePage().getByRole(...args);
    }

    getByLabel(...args: Parameters<Page["getByLabel"]>): Locator {
        return this.#requirePage().getByLabel(...args);
    }

    getByText(...args: Parameters<Page["getByText"]>): Locator {
        return this.#requirePage().getByText(...args);
    }

    getByTestId(...args: Parameters<Page["getByTestId"]>): Locator {
        return this.#requirePage().getByTestId(...args);
    }

    getByPlaceholder(...args: Parameters<Page["getByPlaceholder"]>): Locator {
        return this.#requirePage().getByPlaceholder(...args);
    }

    getByAltText(...args: Parameters<Page["getByAltText"]>): Locator {
        return this.#requirePage().getByAltText(...args);
    }

    getByTitle(...args: Parameters<Page["getByTitle"]>): Locator {
        return this.#requirePage().getByTitle(...args);
    }

    #requirePage(): Page {
        return assertExists(
            this.#page,
            "Must call `runner.goto(...)` before using page interaction APIs",
        );
    }

    async goto(
        session: ScreenshotTestSession,
        path: string,
        {
            peekPath,
            fixedTime = screenshotTestEndTime,
        }: {
            peekPath?: string;
            fixedTime?: Date;
        } = {},
    ): Promise<void> {
        if (this.#page !== null) {
            await this.#page.close();
            this.#page = null;
        }

        if (session !== null) {
            await this.#services.signIn(this.#browserContext, session);
        } else {
            await this.#browserContext.clearCookies();
        }

        const page = await this.#browserContext.newPage();
        this.#page = page;

        // Set the reduced motion preference so there are fewer animations. Animations lead
        // to non-deterministic screenshots.
        await page.emulateMedia({reducedMotion: "reduce"});

        // Set a fixed time for `Date.now()` and `new Date()` on the client so screenshots
        // are deterministic.
        await page.clock.setFixedTime(fixedTime);

        // `context.loader.getInitialTime()` looks for this header to determine what the
        // current time should be for hooks like `useCurrentDate()`.
        await page.setExtraHTTPHeaders({
            "cyberworlds-fixed-time-for-test": fixedTime.toISOString(),
        });

        // Spell check is an alpha feature. Don't show spell check lints.
        await page.addInitScript(
            // eslint-disable-next-line cyberworlds/string-quotes
            "window.localStorage.setItem('disableSpellCheck', 'true')",
        );

        await page.goto(
            getScreenshotUrl(this.#baseUrl, {
                path,
                peekPath,
            }),
        );

        await page.waitForLoadState("networkidle");

        // Waits for our JavaScript to run and React to finish its initial render.
        // eslint-disable-next-line cyberworlds/string-quotes
        await page.waitForFunction("typeof dev !== 'undefined' && dev.ready");

        // If there's a peek path, make sure we wait until the peek has rendered before
        // continuing. Since the peek may take a second or two to load.
        if (peekPath) await page.getByTestId("PeekStackOverlay").waitFor();
    }

    async screenshot(orderKey: string, name: string): Promise<void> {
        // Names must be alphanumeric words separated by hyphens. We only allow one hyphen
        // at a time to separate words. The name can't start or end with a hyphen.
        assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name));

        assert(isOrderKey(orderKey));

        // Screenshot order keys must be unique and in ascending order every call. The
        // order of screenshots taken in the screenshot test file should be the same order
        // as the files on disk.
        if (this.#lastScreenshotOrderKey !== null) {
            assert(orderKey > this.#lastScreenshotOrderKey);
        }
        this.#lastScreenshotOrderKey = orderKey;

        if (this.#screenshotNames.has(name)) {
            throw new InvalidArgumentError(
                quote`Duplicate screenshot name in ${this.testName}: ${name}`,
            );
        }

        this.#screenshotNames.add(name);

        const page = this.#requirePage();

        // Make sure we wait for any background processing (e.g. inbox notification
        // processing) before taking the screenshot.
        await ProcessContextModule.waitForTestTasks();

        // Wait for `JobQueueService` to process all pending jobs from the SQS job queue.
        await this.#services.waitForSqsProcessJobs();

        for (const colorScheme of ["light", "dark"]) {
            // MacOS file systems are case insensitive so encode our order key in binary then
            // print it back in hexadecimal.
            const orderKeyHex = Array.from(encodeOrderKey(orderKey))
                .map(byte => byte.toString(16).padStart(2, "0"))
                .join("");

            // Most file names in `cyberworlds` use `snake_case`. However, for screenshots we
            // use `kebab-case`. The reason is [on the ASCII table the hyphen character (`-`)
            // has a lower value than all alphanumeric characters][1]. Whereas the underscore
            // character (`_`) has a lower value than lower case letters but a higher value
            // than upper case letters and numbers.
            //
            // Since we want files to be sorted by `OrderKey` it's important that the separator
            // character (in this case a hyphen) is sorted BEFORE any of the alphanumeric
            // characters that an `OrderKey` is made up of.
            //
            // Consider the following example:
            //
            // ```ts
            // ["a0", "a01", "a0b"].sort(); // Good: ["a0", "a01", "a0b"]
            //
            // ["a0_", "a01_", "a0b_"].sort(); // Bad: ["a01_", "a0_", "a0b_"]
            //
            // ["a0-", "a01-", "a0b-"].sort(); // Good: ["a0-", "a01-", "a0b-"]
            // ```
            //
            // The `OrderKey`s followed by an underscore place `a01_` before `a0_`. However,
            // the `OrderKey`s followed by a hyphen give us the correct sort.
            //
            // [1]: https://en.wikipedia.org/wiki/ASCII#Character_set
            const fileName = `${this.testName}-${colorScheme}-${orderKeyHex}-${name}.png`;

            this.#screenshotFileNames.add(fileName);

            debug(quote`Screenshot ${fileName} start`);

            // Wait for all scrollbars to be hidden. If the page just scrolled before our
            // screenshot then there may be some visible scrollbars and we need to wait for
            // those scrollbars to disappear.
            const scrollbarsPromise = await page
                .locator(
                    `.${scrollbarStyles.scrollbarThumbHitClassName}:not(.${scrollbarStyles.scrollbarThumbHitHideClassName})`,
                )
                .waitFor({state: "detached"});

            // Make sure we wait for images to load before taking any screenshot.
            const filesPromise = await page.evaluate(
                "dev.files && dev.files.waitForImagePreviewContentsToLoad()",
            );

            // Wait for all CSS animations on the page to finish before taking our screenshot.
            // We only wait for animations with less than a second remaining. Any long running
            // animations (or infinite animations) we ignore. For example, wait until the modal
            // dialog open animation finishes before taking a screenshot so we can capture the
            // modal content.
            const animationsPromise = page.evaluate(() => {
                const toMs = (value: CSSNumberish): number => {
                    if (typeof value === "number") return value;
                    return value.to("ms").value;
                };

                return Promise.all(
                    document
                        .getAnimations()
                        .filter(animation => {
                            const timing = animation.effect?.getComputedTiming();
                            if (!timing) return false;

                            if (timing.endTime == null) return false;
                            if (animation.currentTime == null) return false;

                            const endTime = toMs(timing.endTime);
                            const currentTime = toMs(animation.currentTime);

                            if (!isFinite(endTime)) return false;
                            if (!isFinite(currentTime)) return false;

                            const remainingMs = endTime - currentTime;
                            return remainingMs < 1000 && remainingMs > 0;
                        })
                        .map(animation => animation.finished),
                );
            });

            await runAllPromises([animationsPromise, filesPromise, scrollbarsPromise]);

            const outputPath = joinPath(this.#outputDirectoryPath, fileName);

            let actualOutputPath;
            if (this.#mode !== "update") {
                actualOutputPath = outputPath;
            } else {
                const extensionIndex = outputPath.lastIndexOf(".");
                assert(extensionIndex !== -1);

                actualOutputPath =
                    outputPath.slice(0, extensionIndex) +
                    ".compare" +
                    outputPath.slice(extensionIndex);
            }

            // Make sure for the dark screenshot we're in dark mode.
            if (colorScheme === "dark") await page.evaluate("dev.toggleColorScheme()");

            await page.screenshot({path: actualOutputPath});

            // Make sure we leave dark mode once we're done with the dark mode screenshot.
            if (colorScheme === "dark") await page.evaluate("dev.toggleColorScheme()");

            switch (this.#mode) {
                case "compare":
                case "preview": {
                    debug(quote`Screenshot ${fileName} end`);
                    break;
                }
                case "update": {
                    // If the new screenshot looks the same as the old one then we don't update the old
                    // screenshot. Leaving git history clean (since the new snapshot may have a
                    // different byte sequence).
                    if (!(await pathExists(outputPath))) {
                        await fs.copyFile(actualOutputPath, outputPath);
                        await fs.rm(actualOutputPath);

                        debug(quote`Screenshot ${fileName} end (created)`);
                    } else {
                        const result = await looksSame(actualOutputPath, outputPath, {
                            tolerance: screenshotTestLooksSameTolerance,
                        });
                        if (result.equal) {
                            await fs.rm(actualOutputPath);

                            debug(quote`Screenshot ${fileName} end (same)`);
                        } else {
                            await fs.copyFile(actualOutputPath, outputPath);
                            await fs.rm(actualOutputPath);

                            debug(quote`Screenshot ${fileName} end (changed)`);
                        }
                    }
                    break;
                }
                default:
                    throw exhaustive(this.#mode);
            }
        }
    }

    getScreenshotCount(): number {
        return this.#screenshotNames.size;
    }

    getScreenshotFileNames(): ReadonlySet<string> {
        return this.#screenshotFileNames;
    }

    async close(): Promise<void> {
        if (this.#page !== null) {
            await this.#page.close();
            this.#page = null;
        }
    }
}

export type ScreenshotTestRunner = Pick<
    ScreenshotRunner,
    | "testName"
    | "services"
    | "stableRandom"
    | "createDemoSpace"
    | "page"
    | "mouse"
    | "getByRole"
    | "getByLabel"
    | "getByText"
    | "getByTestId"
    | "getByPlaceholder"
    | "getByAltText"
    | "getByTitle"
    | "goto"
    | "screenshot"
>;

export async function runScreenshotTests({
    mode,
    definitions,
}: {
    mode: ScreenshotTestMode;
    definitions: ReadonlyArray<ScreenshotTestDefinition>;
}) {
    if (definitions.length === 0) {
        throw new InvalidArgumentError("No screenshot tests were provided");
    }

    switch (mode) {
        case "compare": {
            // We only allow updating/comparing screenshots on Linux CI machines. Since there
            // are subtle differences in text rendering across operating systems.
            if (os.platform() !== "linux") {
                const target =
                    definitions.length === 1
                        ? `${assertExists(definitions[0]).testName}_preview`
                        : "preview";

                throw new InvalidArgumentError(
                    `Can only update screenshots on Linux machines to avoid OS text rendering inconsistencies. Use \`bazel run //app/screenshot_tests:${target}\` instead for a local preview`,
                );
            }

            const testUndeclaredOutputsPath = assertExists(
                process.env.TEST_UNDECLARED_OUTPUTS_DIR,
                "Must be running screenshot test compare mode with `bazel test` (so `TEST_UNDECLARED_OUTPUTS_DIR` is available)",
            );

            const testTmpdirPath = assertExists(
                process.env.TEST_TMPDIR,
                "Must be running screenshot test compare mode with `bazel test` (so `TEST_TMPDIR` is available)",
            );

            const runners = await actuallyRunScreenshotTests({
                mode,
                definitions,
                undeclaredOutputsDirectoryPath: testUndeclaredOutputsPath,
                createTemporaryDirectoryPath: async () => {
                    await fs.mkdir(testTmpdirPath, {recursive: true});
                    return fs.mkdtemp(joinPath(testTmpdirPath, "cyberworlds_test_"));
                },
                outputDirectoryPath: () => joinPath(testUndeclaredOutputsPath, "actual"),
            });

            await fs.mkdir(joinPath(testUndeclaredOutputsPath, "diff"), {recursive: true});

            await runAllPromises(
                runners.flatMap(runner => {
                    const expectedDirectoryPath = joinPath(
                        runfilesPath,
                        "cyberworlds/app/screenshot_tests/screenshots",
                        runner.testName,
                    );

                    return Array.from(runner.getScreenshotFileNames(), screenshotFileName =>
                        compareScreenshot({
                            testName: runner.testName,
                            screenshotFileName,
                            expectedPath: joinPath(expectedDirectoryPath, screenshotFileName),
                            actualPath: joinPath(
                                testUndeclaredOutputsPath,
                                "actual",
                                screenshotFileName,
                            ),
                            diffDirectoryPath: joinPath(testUndeclaredOutputsPath, "diff"),
                        }),
                    );
                }),
            );
            break;
        }
        case "update": {
            // We only allow updating/comparing screenshots on Linux CI machines. Since there
            // are subtle differences in text rendering across operating systems.
            if (os.platform() !== "linux") {
                const target =
                    definitions.length === 1
                        ? `${assertExists(definitions[0]).testName}_preview`
                        : "preview";

                throw new InvalidArgumentError(
                    `Can only update screenshots on Linux machines to avoid OS text rendering inconsistencies. Use \`bazel run //app/screenshot_tests:${target}\` instead for a local preview`,
                );
            }

            assert(process.env.BUILD_WORKSPACE_DIRECTORY);

            // Create a temporary directory in the `development` environment's temporary
            // directory.
            const developmentEnv = parseDotenvForNodeEnv("development");
            const devEnvPaths = createDevEnvPaths(developmentEnv);

            await withTemporaryDirectory(
                devEnvPaths.temp,
                "screenshots_",
                async temporaryDirectoryPath => {
                    await actuallyRunScreenshotTests({
                        mode,
                        definitions,
                        undeclaredOutputsDirectoryPath: temporaryDirectoryPath,
                        createTemporaryDirectoryPath: () =>
                            fs.mkdtemp(joinPath(temporaryDirectoryPath, "temporary_")),
                        outputDirectoryPath: testName =>
                            joinPath(
                                getWorkspacePath(),
                                "app/screenshot_tests/screenshots",
                                testName,
                            ),
                    });
                },
            );
            break;
        }
        case "preview": {
            assert(process.env.BUILD_WORKSPACE_DIRECTORY);

            // Create preview screenshots in the `development` environment's temporary
            // directory.
            const developmentEnv = parseDotenvForNodeEnv("development");
            const devEnvPaths = createDevEnvPaths(developmentEnv);

            const currentTime = new Date();

            const previewDirectoryPath = joinPath(
                devEnvPaths.temp,
                "screenshots",
                currentTime.getFullYear().toString().padStart(4, "0") +
                    "-" +
                    (currentTime.getMonth() + 1).toString().padStart(2, "0") +
                    "-" +
                    currentTime.getDate().toString().padStart(2, "0") +
                    "-" +
                    (
                        currentTime.getHours() * 60 * 60 +
                        currentTime.getMinutes() * 60 +
                        currentTime.getSeconds()
                    )
                        .toString()
                        .padStart(5, "0"),
            );

            await fs.mkdir(previewDirectoryPath, {recursive: true});

            debug(quote`Writing screenshots to: ${previewDirectoryPath}`);

            await withTemporaryDirectory(
                devEnvPaths.temp,
                "screenshots_",
                async temporaryDirectoryPath => {
                    await actuallyRunScreenshotTests({
                        mode,
                        definitions,
                        undeclaredOutputsDirectoryPath: temporaryDirectoryPath,
                        createTemporaryDirectoryPath: () =>
                            fs.mkdtemp(joinPath(temporaryDirectoryPath, "temporary_")),
                        outputDirectoryPath: testName => joinPath(previewDirectoryPath, testName),
                    });
                },
            );

            debug(quote`Screenshots written to: ${previewDirectoryPath}`);
            break;
        }
        default:
            throw exhaustive(mode);
    }
}

async function actuallyRunScreenshotTests({
    mode,
    definitions,
    undeclaredOutputsDirectoryPath,
    createTemporaryDirectoryPath,
    outputDirectoryPath,
}: {
    mode: ScreenshotTestMode;
    definitions: ReadonlyArray<ScreenshotTestDefinition>;
    undeclaredOutputsDirectoryPath: string;
    createTemporaryDirectoryPath: () => Promise<string>;
    outputDirectoryPath: (testName: string) => string;
}) {
    const runners: Array<ScreenshotRunner> = [];

    await withIntegrationTestEnvironment(
        {
            undeclaredOutputsDirectoryPath: joinPath(undeclaredOutputsDirectoryPath, "environment"),
            createTemporaryDirectoryPath,
        },
        async (context, services) => {
            for (const definition of definitions) {
                const runner = await runScreenshotTest({
                    mode,
                    definition,
                    context,
                    services,
                    outputDirectoryPath: outputDirectoryPath(definition.testName),
                });

                runners.push(runner);
            }
        },
    );

    return runners;
}

async function runScreenshotTest({
    mode,
    definition: {testName, run},
    context,
    services,
    outputDirectoryPath,
}: {
    mode: ScreenshotTestMode;
    definition: ScreenshotTestDefinition;
    context: TestActualContext;
    services: TestServices;
    outputDirectoryPath: string;
}): Promise<ScreenshotRunner> {
    debug(quote`Starting screenshot test ${testName} in ${mode} mode`);

    await fs.mkdir(outputDirectoryPath, {recursive: true});

    switch (mode) {
        case "compare": {
            const runner = await actuallyRunScreenshotTest({
                testName,
                mode,
                context,
                services,
                outputDirectoryPath,
                run,
            });
            return runner;
        }
        case "update": {
            const runner = await actuallyRunScreenshotTest({
                testName,
                mode,
                context,
                services,
                outputDirectoryPath,
                run,
            });

            const oldOutputDirectoryFileNames = new Set(await fs.readdir(outputDirectoryPath));
            const newOutputDirectoryFileNames = runner.getScreenshotFileNames();

            for (const fileName of newOutputDirectoryFileNames)
                oldOutputDirectoryFileNames.delete(fileName);

            await runAllPromises(
                Array.from(oldOutputDirectoryFileNames, fileName =>
                    fs.rm(joinPath(outputDirectoryPath, fileName)),
                ),
            );
            return runner;
        }
        case "preview": {
            const runner = await actuallyRunScreenshotTest({
                testName,
                mode,
                context,
                services,
                outputDirectoryPath,
                run,
            });
            return runner;
        }
        default:
            throw exhaustive(mode);
    }
}

async function actuallyRunScreenshotTest({
    testName,
    mode,
    context,
    services,
    outputDirectoryPath,
    run,
}: {
    testName: string;
    mode: ScreenshotTestMode;
    context: TestActualContext;
    services: TestServices;
    outputDirectoryPath: string;
    run: (context: TestActualContext, runner: ScreenshotTestRunner) => Promise<void>;
}) {
    const baseUrl = await services.waitForBaseUrl();

    const browser = await chromium.launch({
        headless: true,
        args: [
            // These args improve text rendering consistency accross operating systems.
            //
            // https://github.com/microsoft/playwright/issues/20097#issuecomment-1382672908
            "--font-render-hinting=none",
            "--disable-skia-runtime-opts",
            "--disable-font-subpixel-positioning",
            "--disable-lcd-text",
        ],
    });

    const browserContext = await browser.newContext({
        ...devices["Desktop Chrome"],
        viewport: defaultViewport,
        // Take screenshots as if they were on a retina display.
        //
        // The reason this isn't higher (e.g. 3) is because we optimize file image resizing
        // for DPI 2 max on desktop and DPI 3 max on mobile. Our file resizer doesn't
        // currently support sizes you'd need on higher DPIs than 2 for desktop. So for any
        // images we display in screenshots we don't want them upscaled just to be
        // downscaled again (may create weird looking artifacts).
        deviceScaleFactor: 2,
        timezoneId: "America/New_York",
        // Always use a user agent for Chrome on MacOS. This should make sure we use the
        // command symbol (instead of control) for keyboard shortcuts around the product.
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    });

    debug("Launched Playwright browser");

    const runner = new ScreenshotRunner({
        testName,
        mode,
        baseUrl,
        browserContext,
        services,
        outputDirectoryPath,
    });

    try {
        await run(context, runner);

        if (runner.getScreenshotCount() === 0) {
            throw new InvalidArgumentError(
                quote`Screenshot test ${testName} did not define any screenshots`,
            );
        }
    } finally {
        await runner.close();
        debug("Closing Playwright browser");
        await browserContext.close();
        await browser.close();
    }

    return runner;
}

function getScreenshotUrl(
    baseUrl: string,
    {path, peekPath}: {path: string; peekPath?: string},
): string {
    const url = new URL(path, baseUrl);

    if (peekPath) {
        url.searchParams.set("peek", peekPath);
    }

    return url.toString();
}

async function compareScreenshot({
    testName,
    screenshotFileName,
    expectedPath,
    actualPath,
    diffDirectoryPath,
}: {
    testName: string;
    screenshotFileName: string;
    expectedPath: string;
    actualPath: string;
    diffDirectoryPath: string;
}) {
    if (!(await pathExists(expectedPath))) {
        throw new InvalidArgumentError(
            quote`Missing expected screenshot for ${`${testName}/${screenshotFileName}`}`,
        );
    }

    const result = await looksSame(actualPath, expectedPath, {
        tolerance: screenshotTestLooksSameTolerance,
        createDiffImage: true,
    });

    if (result.equal) return;

    const fileName = basename(expectedPath);

    if (result.diffImage) {
        await result.diffImage.save(joinPath(diffDirectoryPath, fileName));
    }

    throw new InternalError(
        quote`Screenshot ${`${testName}/${screenshotFileName}`} did not match expected output. Compare results are saved in \`bazel-testlogs\`.`,
    );
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}
