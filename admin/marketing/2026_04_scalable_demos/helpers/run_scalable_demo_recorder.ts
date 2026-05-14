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
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";
import {PrettyMarkdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

/**
 * A single collaborator\u2019s contribution to a recording.
 *
 * The recorder creates a dedicated signed-in browser window for this session up
 * front (before the human starts recording) and hands the same Playwright `Page`
 * to every callback in `actions`. Actions run sequentially \u2014 any navigation,
 * typing, or clicking happens inside the callback.
 *
 * Multiple collaborators run their `actions` arrays concurrently.
 */
export type ScalableDemoRecorderCollaborator = {
    session: TestSpaceSession | TestSession;
    actions: ReadonlyArray<(page: Page) => Promise<void>>;
};

export class ScalableDemoRecorder {
    private readonly _services: TestServices;
    private readonly _baseUrl: string;
    private readonly _browser: Browser;
    private readonly _browserContext: BrowserContext;
    // Collaborator browsers run in a separate **headless** Chromium instance so they
    // don\u2019t steal screen real estate or keyboard focus from the headed primary
    // browser the human is recording. Created lazily on first use.
    private _collaboratorBrowser: Browser | null = null;
    private readonly _secondaryContexts: Array<BrowserContext> = [];

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
        fixedTime,
        prepare,
        actions,
        collaborators,
    }: {
        instructions: PrettyMarkdown;
        session: TestSpaceSession | TestSession | null;
        path: string;
        viewport?: {width: number; height?: number};
        fixedTime?: Date;
        prepare?: (page: Page) => Promise<void>;
        /**
         * Playwright actions to run automatically in the primary (headed) browser window
         * that the human is screen-recording. Mirrors the collaborators `actions`
         * interface but drives the main session instead of a headless second window.
         *
         * When provided the recorder prompts the human to start their screen recorder,
         * then runs the actions sequentially and waits for a final \u201CFinished
         * recording?\u201D confirmation before closing. When both `actions` and
         * `collaborators` are provided the actions run concurrently.
         *
         * If omitted the recorder falls back to the manual flow where instructions are
         * printed and the human drives the UI themselves.
         */
        actions?: ReadonlyArray<(page: Page) => Promise<void>>;
        /**
         * Other signed-in browser windows that drive realtime state during the recording
         * (incoming chat messages, typing indicators, another account\u2019s presence,
         * reactions, etc.). Keyed by an arbitrary string identifier the caller picks
         * \u2014 it\u2019s only used in log output.
         *
         * Each collaborator\u2019s browser is created, signed in, and given a blank page
         * **before** the human starts recording, so opening a second browser window
         * doesn\u2019t happen while the screen recorder is rolling. The `actions` array
         * runs sequentially inside that browser, and different collaborators run their
         * arrays concurrently. Actions don\u2019t start until **after** the \u201Cpress
         * enter to fire collaborator actions\u201D prompt \u2014 so you have time to start
         * your screen recorder first.
         */
        collaborators?: Record<string, ScalableDemoRecorderCollaborator>;
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

            if (fixedTime !== undefined) {
                await setPageFixedTime(page, fixedTime);
            }

            await page.goto(new URL(path, this._baseUrl).toString());

            // Waits for our JavaScript to run and React to finish its initial render.
            // eslint-disable-next-line cyberworlds/string-quotes
            await page.waitForFunction("typeof dev !== 'undefined' && dev.ready");

            await prepare?.(page);

            // Spin up each collaborator\u2019s browser up front so the cost of opening a new
            // Chromium context doesn\u2019t happen while the human is screen recording. The
            // page is blank until the first action navigates it.
            const collaboratorPages = collaborators
                ? await this._openCollaboratorPages(collaborators, fixedTime)
                : new Map<string, Page>();

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

            const hasAutomatedActions = actions !== undefined && actions.length > 0;

            const hasCollaborators =
                collaborators !== undefined && Object.keys(collaborators).length > 0;

            if (hasAutomatedActions) {
                // Automated mode: run actions in the primary window so the human only needs to
                // start/stop their screen recorder. Collaborator actions start at the same time as
                // the primary actions so they run concurrently.
                await inquirer.confirm({
                    message: `Start recording, then press Enter to run automated actions${hasCollaborators ? " and collaborator actions" : ""}.`,
                });
                // eslint-disable-next-line no-console
                console.log();
                const collaboratorsHandle = hasCollaborators
                    ? runCollaboratorsInBackground(collaborators, collaboratorPages)
                    : null;

                try {
                    // eslint-disable-next-line no-console
                    console.log("Running automated actions...");
                    for (const action of actions) {
                        await action(page);
                    }
                    // eslint-disable-next-line no-console
                    console.log("Automated actions complete.");
                    // eslint-disable-next-line no-console
                    console.log();
                    await inquirer.confirm({message: "Finished recording?"});
                } finally {
                    await collaboratorsHandle?.cancel();
                }
            } else {
                // Manual mode: human drives the UI, collaborators fire on Enter.
                if (hasCollaborators) {
                    await inquirer.confirm({
                        message:
                            "Start recording, then press enter to fire the collaborator actions.",
                    });
                }

                const collaboratorsHandle = hasCollaborators
                    ? runCollaboratorsInBackground(collaborators, collaboratorPages)
                    : null;

                try {
                    await inquirer.confirm({message: "Finished recording?"});
                } finally {
                    await collaboratorsHandle?.cancel();
                }
            }
        } finally {
            await page.close();
            for (const browserContext of this._secondaryContexts) {
                await browserContext.close();
            }
            this._secondaryContexts.length = 0;
            if (this._collaboratorBrowser) {
                await this._collaboratorBrowser.close();
                this._collaboratorBrowser = null;
            }
        }
    }

    private async _openCollaboratorPages(
        collaborators: Record<string, ScalableDemoRecorderCollaborator>,
        fixedTime: Date | undefined,
    ): Promise<Map<string, Page>> {
        // Launch one headless Chromium for all collaborators \u2014 cheaper than one per
        // collaborator, and since they\u2019re invisible there\u2019s no reason to isolate
        // them at the OS-window level. Separate from the primary browser so the
        // human\u2019s headed recording window isn\u2019t fighting collaborator windows
        // for focus or screen real estate.
        const collaboratorBrowser = (this._collaboratorBrowser ??= await chromium.launch({
            headless: true,
        }));

        const collaboratorPages = new Map<string, Page>();
        await runAllPromises(
            Object.entries(collaborators).map(async ([id, config]) => {
                const browserContext = await collaboratorBrowser.newContext({
                    ...devices["Desktop Chrome"],
                    viewport: scalableDemoDefaultViewport,
                    deviceScaleFactor: 2,
                    timezoneId: "America/New_York",
                    // So callbacks can `page.goto("/s/.../chat/...")` with a relative URL \u2014
                    // Playwright resolves it against `baseURL`.
                    baseURL: this._baseUrl,
                });
                this._secondaryContexts.push(browserContext);

                await this._services.signIn(browserContext, config.session);

                const collaboratorPage = await browserContext.newPage();
                if (fixedTime !== undefined) {
                    await setPageFixedTime(collaboratorPage, fixedTime);
                }
                collaboratorPages.set(id, collaboratorPage);
            }),
        );
        return collaboratorPages;
    }
}

async function setPageFixedTime(page: Page, fixedTime: Date) {
    // Match screenshot tests: freeze browser Date APIs and pass the same timestamp
    // through the request header used by server-rendered time hooks.
    await page.clock.setFixedTime(fixedTime);
    await page.setExtraHTTPHeaders({
        "cyberworlds-fixed-time-for-test": fixedTime.toISOString(),
    });
}

/**
 * Run each collaborator\u2019s `actions` array concurrently. Each collaborator
 * runs its own actions sequentially so callers can reason about order within a
 * single browser. Errors in one action are logged but don\u2019t abort the
 * recording or cancel other collaborators.
 */
function runCollaboratorsInBackground(
    collaborators: Record<string, ScalableDemoRecorderCollaborator>,
    collaboratorPages: Map<string, Page>,
): {cancel: () => Promise<void>} {
    let cancelled = false;

    const collaboratorPromises = Object.entries(collaborators).map(async ([id, config]) => {
        const collaboratorPage = collaboratorPages.get(id);
        if (!collaboratorPage) return;

        // eslint-disable-next-line no-console
        console.log(`Running collaborator \`${id}\` actions...`);

        for (const action of config.actions) {
            if (cancelled) return;

            try {
                await action(collaboratorPage);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(`Recorder action for collaborator ${id} failed:`, error);
            }
        }
        // eslint-disable-next-line no-console
        console.log(`Finished running collaborator \`${id}\` actions.`);
    });

    return {
        cancel: async () => {
            cancelled = true;
            await runAllPromises(collaboratorPromises);
        },
    };
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
