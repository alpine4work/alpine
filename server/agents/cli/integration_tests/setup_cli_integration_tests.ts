import {mkdir, mkdtemp, writeFile} from "fs/promises";
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
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type CliIntegrationTests = {
    readonly services: TestServices;
    readonly session: TestSpaceSession;
    run(command: string): Promise<string>;
};

/**
 * Sets up the Alpine CLI and its integration test environment for a Jest file.
 */
export function setupCliIntegrationTests(): CliIntegrationTests {
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

    let session: TestSpaceSession | undefined;
    let dataDirectoryPath: string | undefined;

    beforeAll(async () => {
        const space = await TestSpace.create(context);
        session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session, {name: "My Bot"});
        const apiKey = await botAccount.createApiKey();

        dataDirectoryPath = joinPath(context.getTemporaryDirectoryPath(), "alpine-data");
        await mkdir(dataDirectoryPath, {recursive: true});

        await writeFile(
            joinPath(dataDirectoryPath, "auth.json"),
            JSON.stringify({apiKey, apiUrl: services.getApiServiceBaseUrl()}),
        );
    });

    async function run(command: string): Promise<string> {
        assert(command.startsWith("alpine "));

        const actualCommand =
            joinPath(runfilesPath, "cyberworlds/server/agents/cli/cli.sh") +
            " " +
            command.slice("alpine ".length);

        await ProcessContextModule.waitForTestTasks();
        await services.waitForSqsProcessJobs();
        await refreshSearchEntityKeywordIndexForTest(context);

        return await runProcess("/bin/sh", ["-c", actualCommand], {
            cwd: runfilesPath,
            env: {ALPINE_DATA_PATH: assertExists(dataDirectoryPath)},
        });
    }

    return {
        services,
        get session() {
            return assertExists(session);
        },
        run,
    };
}
