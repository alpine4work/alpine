import {spawn} from "child_process";
import {join as joinPath} from "path";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Deploy Cloudflare by running `bazel run //server/edge:wrangler -- deploy`.
 * Should behave the same as if you run it locally. Except locally to
 * authenticate you need to run `bazel run //server/edge:wrangler -- login`.
 */
export async function deployCloudflareWorkers(
    context: Context<{
        tracer: TracerContextModule;
    }>,
    {
        accountId,
        workersToken,
    }: {
        accountId: string;
        workersToken: string;
    },
) {
    await context.tracer.withSpan("Deploy Edge Service", async () => {
        const deployEdgeServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/edge/wrangler.sh"),
            ["deploy"],
            {
                cwd: joinPath(runfilesPath, "cyberworlds"),
                env: {
                    ...getProcessEnvToPropagate(),
                    CLOUDFLARE_ACCOUNT_ID: accountId,
                    CLOUDFLARE_API_TOKEN: workersToken,
                },
                stdio: ["ignore", "inherit", "inherit"],
            },
        );

        await waitForProcessExit(deployEdgeServiceSubprocess);
    });

    await context.tracer.withSpan("Deploy Agent Service", async () => {
        const deployAgentServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/agents/wrangler.sh"),
            ["deploy"],
            {
                cwd: joinPath(runfilesPath, "cyberworlds"),
                env: {
                    ...getProcessEnvToPropagate(),
                    CLOUDFLARE_ACCOUNT_ID: accountId,
                    CLOUDFLARE_API_TOKEN: workersToken,
                },
                stdio: ["ignore", "inherit", "inherit"],
            },
        );

        await waitForProcessExit(deployAgentServiceSubprocess);
    });

    await context.tracer.withSpan("Deploy Resource Service", async () => {
        const deployResourceServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/resources/wrangler.sh"),
            ["deploy"],
            {
                cwd: joinPath(runfilesPath, "cyberworlds"),
                env: {
                    ...getProcessEnvToPropagate(),
                    CLOUDFLARE_ACCOUNT_ID: accountId,
                    CLOUDFLARE_API_TOKEN: workersToken,
                },
                stdio: ["ignore", "inherit", "inherit"],
            },
        );

        await waitForProcessExit(deployResourceServiceSubprocess);
    });
}
