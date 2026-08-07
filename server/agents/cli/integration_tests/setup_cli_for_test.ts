import {mkdir, mkdtemp, rmdir, symlink, writeFile} from "fs/promises";
import {join as joinPath} from "path";
import {
    TestServices,
    actuallyCreateIntegrationTestEnvironment,
} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {refreshSearchEntityKeywordIndexForTest} from "~/server/search/data/index/search_entity_index.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

export type CliIntegrationTests = {
    readonly dataDirectoryPath: string;
    readonly services: TestServices;
    readonly space: TestSpace;
    readonly session: TestSpaceSession;
    run(command: string, options?: {baseUrl?: string}): Promise<string>;
};

/**
 * Sets up the Alpine CLI and its integration test environment for a Jest file.
 */
export function setupCliForTest({
    agentWebTaskQueryCursorHash,
}: {
    agentWebTaskQueryCursorHash?: string;
} = {}): CliIntegrationTests {
    import.meta.jest.setTimeout(60 * 1000);

    const testTmpdirPath = assertExists(process.env.TEST_TMPDIR);

    const {context, services} = actuallyCreateIntegrationTestEnvironment(
        {
            beforeEach,
            afterEach,
            beforeAll,
            afterAll,
            setTimeout: timeout => import.meta.jest.setTimeout(timeout),
        },
        {
            undeclaredOutputsDirectoryPath: assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR),
            createTemporaryDirectoryPath: async () => {
                await mkdir(testTmpdirPath, {recursive: true});
                return await mkdtemp(joinPath(testTmpdirPath, "cyberworlds_test_"));
            },
            // The CLI only needs `ApiService` and whatever services `ApiService` depends on.
            shouldStartAgentService: false,
        },
    );

    let space: TestSpace | undefined;
    let session: TestSpaceSession | undefined;
    let dataDirectoryPath: string | undefined;
    let binDirectoryPath: string | undefined;

    beforeAll(async () => {
        dataDirectoryPath = joinPath(context.getTemporaryDirectoryPath(), "alpine-data");

        binDirectoryPath = joinPath(context.getTemporaryDirectoryPath(), "alpine-bin");
        await mkdir(binDirectoryPath, {recursive: true});

        await symlink(
            joinPath(runfilesPath, "cyberworlds/server/agents/cli/cli.sh"),
            joinPath(binDirectoryPath, "alpine"),
        );
    });

    let hasInitiallyRun = false;

    beforeEach(async () => {
        const isInitialRun = !hasInitiallyRun;
        hasInitiallyRun = true;

        space = await TestSpace.create(context);
        session = await space.createSession({name: "Anthony Mose", role: "Admin"});

        const botAccount = await TestBot.createAndInstantiate(session, {name: "My Bot"});
        const apiKey = await botAccount.createApiKey();

        assert(dataDirectoryPath);

        if (!isInitialRun) await rmdir(dataDirectoryPath, {recursive: true});
        await mkdir(dataDirectoryPath, {recursive: true});
        await writeFile(joinPath(dataDirectoryPath, "auth.json"), JSON.stringify({apiKey}));
    });

    async function run(command: string, options?: {baseUrl?: string}): Promise<string> {
        await ProcessContextModule.waitForTestTasks();
        await services.waitForSqsProcessJobs();
        await refreshSearchEntityKeywordIndexForTest(context);

        return await runWithoutWaiting(command, options);
    }

    async function runWithoutWaiting(
        command: string,
        {baseUrl = services.getBaseUrl()}: {baseUrl?: string} = {},
    ): Promise<string> {
        return await runProcess("/bin/sh", ["-c", command], {
            cwd: runfilesPath,
            isErrorExitCode: () => false,
            env: {
                TZ: defaultTimeZone,
                PATH: process.env.PATH
                    ? `${binDirectoryPath}:${process.env.PATH}`
                    : binDirectoryPath,
                ALPINE_URL: baseUrl,
                ALPINE_API_URL: services.getApiServiceBaseUrl(),
                ALPINE_DATA_PATH: assertExists(dataDirectoryPath),
                AGENT_WEB_TASK_QUERY_CURSOR_HASH_FOR_TEST: agentWebTaskQueryCursorHash,
            },
        });
    }

    return {
        services,
        get dataDirectoryPath() {
            return assertExists(dataDirectoryPath);
        },
        get space() {
            return assertExists(space);
        },
        get session() {
            return assertExists(session);
        },
        run,
    };
}
