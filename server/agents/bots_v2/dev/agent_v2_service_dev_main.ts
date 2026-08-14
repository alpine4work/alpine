import * as inquirer from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs/promises";
import {join} from "path";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {
    FailedPreconditionError,
    InternalError,
    UnimplementedError,
} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

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

async function main() {
    const env = parseDotenv();

    const wranglerPath = join(runfilesPath, "cyberworlds/server/agents/bots_v2/dev/wrangler.sh");

    const workerName = `agent-v2-service${assertExists(env.DEV_ENV_PATHS_NAME_SUFFIX)}`;
    const port = parseInt(assertExists(env.AGENTS_V2_DEV_PORT), 10);

    try {
        // Make sure `dev` is currently running and specially `AppService` is currently
        // running.
        await waitForHttpServer(parseInt(assertExists(env.APP_DEV_PORT), 10), undefined, {
            timeout: 2 * 1000,
        });
    } catch (error) {
        throw new FailedPreconditionError("Must run `dev` first before `AgentV2Service`", {
            cause: error,
        });
    }

    await runProcess("docker", ["--version"]).catch(error => {
        throw new FailedPreconditionError(
            "Docker must be installed and available on `PATH` to run `AgentV2Service`",
            {cause: error},
        );
    });

    const dockerContainerIds = (
        await runProcess("docker", [
            "ps",
            "--quiet",
            "--filter",
            `name=^/workerd-${workerName}-ClaudeAgentSandbox-`,
        ]).catch(error => {
            throw new FailedPreconditionError(
                "Could not communicate with Docker. Make sure Docker Desktop is running",
                {cause: error},
            );
        })
    )
        .trim()
        .split("\n")
        .filter(dockerContainerId => dockerContainerId.length > 0);

    if (dockerContainerIds.length > 0) {
        await runProcess("docker", ["stop", dockerContainerIds]);
        await runProcess("docker", ["rm", dockerContainerIds]);
    }

    const settings: {isLiveReloadMessageConfirmed?: boolean} = await fs
        .readFile(join(devEnvPaths.data, "agent_v2/settings.json"), "utf8")
        .then(string => JSON.parse(string))
        .catch(error => {
            if (isObject(error) && error.code === "ENOENT") return {};
            throw error;
        });

    // You have to restart the `AgentV2Service` script whenever you have some changes
    // you want to test because `wrangler` doesn't appear to live reload changes to
    // containers. Therefore you unfortunately need to manually reload the script
    // yourself.
    //
    // eslint-disable-next-line no-console
    console.log(
        `\n${chalk.bold.red("Important:")} \`AgentV2Service\` doesn\u2019t live reload. If you make code changes you need to manually terminate and restart this script.`,
    );

    // Make the developer confirm they've read the above message. So they don't get
    // confused when editing code and nothing is happening. Since unlike `dev` you must
    // manually restart the `AgentV2Service` script whenever you make a change.
    if (!settings.isLiveReloadMessageConfirmed) {
        // eslint-disable-next-line no-console
        console.log();

        if (!(await inquirer.confirm({message: "Got it?"}))) {
            // eslint-disable-next-line no-console
            console.log();

            throw new InternalError("Must confirm");
        }

        await fs.mkdir(join(devEnvPaths.data, "agent_v2"), {recursive: true});

        await fs.writeFile(
            join(devEnvPaths.data, "agent_v2/settings.json"),
            JSON.stringify({...settings, isLiveReloadMessageConfirmed: true}),
        );
    }

    const [claudeUnscopedApiKey] = await runAllPromises([
        fs.readFile(join(devEnvPaths.config, "keys/claude_unscoped_api_key"), "utf8"),
        fs.mkdir(join(devEnvPaths.config, "agent_v2/sandbox"), {recursive: true}),
        fs.mkdir(join(devEnvPaths.temp, "agent_v2/sandbox"), {recursive: true}),
    ]);

    const wranglerEnv: Record<string, string> = {};

    wranglerEnv.EDGE_SERVICE_URL = `http://localhost:${assertExists(env.EDGE_DEV_PORT)}`;
    wranglerEnv.API_SERVICE_URL = `http://localhost:${assertExists(env.API_DEV_PORT)}`;
    wranglerEnv.CLAUDE_API_SERVICE_KEY = claudeUnscopedApiKey;

    if (typeof env.CLAUDE_WEBHOOK_SECRET === "string") {
        wranglerEnv.CLAUDE_WEBHOOK_SECRET = env.CLAUDE_WEBHOOK_SECRET;
    }

    if (typeof env.HONEYCOMB_API_KEY === "string") {
        wranglerEnv.HONEYCOMB_API_KEY = env.HONEYCOMB_API_KEY;
    }

    // Copy files into a directory we'll run wrangler in.
    await runAllPromises([
        fs.writeFile(
            join(devEnvPaths.config, "agent_v2/.env"),
            Object.entries(wranglerEnv)
                .map(([key, value]) => `${key}=${value}`)
                .join("\n") + "\n",
        ),
        ...[
            "wrangler.toml",
            "agent_v2_service_bundle.js",
            "sandbox/claude_agent.dockerfile",
            "sandbox/claude_agent_service_bundle.mjs",
            "sandbox/sandbox_skills.tar.gz",
        ].map(async name => {
            const sourcePath = join(runfilesPath, `cyberworlds/server/agents/bots_v2/${name}`);
            const temporaryPath = join(devEnvPaths.temp, `agent_v2/${name}.tmp`);
            const destinationPath = join(devEnvPaths.config, `agent_v2/${name}`);
            await fs.copyFile(sourcePath, temporaryPath);
            await fs.chmod(temporaryPath, 0o644);
            await fs.rename(temporaryPath, destinationPath);
        }),
    ]);

    // Run wrangler with the build outputs from Bazel. `dev` will rebuild the agent
    // service `.js` bundle and other files whenever they change. Wrangler running out
    // of the build directory will pick up those changes and hot reload the server.
    process.chdir(join(devEnvPaths.config, "agent_v2"));

    // @ts-expect-error: Available as an experimental API in Node.js v22.15+.
    // Eventually when we upgrade `@types/node` this type should become available.
    process.execve(
        wranglerPath,
        [
            "wrangler",
            "dev",
            "agent_v2_service_bundle.js",
            // We change the worker name since wrangler will use the worker name in the Docker
            // container name. That way when we restart the process we can find old docker
            // containers based on the worktree name and only stop those.
            "--name",
            workerName,
            "--persist-to",
            join(devEnvPaths.data, "agent_v2/wrangler"),
            "--port",
            `${port}`,
            "--var",
            "SANDBOX_LOG_FORMAT:pretty",
        ],
        {
            BAZEL_BINDIR: ".",
            ...Object.fromEntries(
                Object.entries(getProcessEnvToPropagate()).filter(
                    ([, value]) => value !== undefined,
                ),
            ),
        },
    );

    // `process.execve()` should immediately stop Node.js without running any cleanup.
    // Any code after the `process.execve()` call is thus unreachable.
    throw new UnimplementedError("Unreachable");
}
