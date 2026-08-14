import {ChildProcess, spawn} from "child_process";
import fs from "fs/promises";
import os from "os";
import {join as joinPath} from "path";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExitWithAnyCode} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.open_source.js";

const maxCloudflareDeployAttempts = 3;
const sleepBetweenAttemptsMs = 3000;

/**
 * Deploys a Cloudflare worker with retry logic for any errors. Retries up to 2
 * times with a sleep between attempts.
 */
async function deployCloudflareWorkerWithRetry(
    context: Context<{tracer: TracerContextModule}>,
    serviceName: string,
    wranglerPath: string,
    env: Record<string, string> & NodeJS.ProcessEnv,
): Promise<void> {
    let attempt = 1;

    while (true) {
        try {
            await context.tracer.withSpan(`Deploy ${serviceName}`, async (context, span) => {
                span.addData({
                    cloudflare: {
                        wrangler: {
                            attempt,
                        },
                    },
                });

                const subprocess: ChildProcess = spawn(wranglerPath, ["deploy"], {
                    cwd: joinPath(runfilesPath, "cyberworlds"),
                    env,
                    stdio: ["ignore", "inherit", "inherit"],
                });

                const {exitCode} = await waitForProcessExitWithAnyCode(subprocess);

                if (exitCode !== 0) {
                    throw new UnknownError(`Wrangler deployment failed with exit code ${exitCode}`);
                }
            });

            // If we get here, the deployment succeeded
            return;
        } catch (error) {
            if (attempt === maxCloudflareDeployAttempts) {
                throw error;
            } else {
                // eslint-disable-next-line no-console
                console.error(
                    `Deploy ${serviceName} failed. Retrying in ${
                        sleepBetweenAttemptsMs / 1000
                    } seconds... (attempt ${attempt}/${maxCloudflareDeployAttempts})`,
                    error,
                );

                await new Promise(resolve => setTimeout(resolve, sleepBetweenAttemptsMs));
            }
        }

        attempt += 1;
    }
}

/**
 * Applies D1 database migrations.
 */
async function applyCloudflareD1Migrations(
    context: Context<{tracer: TracerContextModule}>,
    databaseName: string,
    wranglerPath: string,
    env: Record<string, string> & NodeJS.ProcessEnv,
): Promise<void> {
    await context.tracer.withSpan(`Apply D1 migrations`, async (context, span) => {
        span.addData({
            cloudflare: {
                d1: {
                    action: "ApplyMigrations",
                    databaseName,
                },
            },
        });

        const subprocess: ChildProcess = spawn(
            wranglerPath,
            ["d1", "migrations", "apply", databaseName, "--remote"],
            {
                cwd: joinPath(runfilesPath, "cyberworlds"),
                env,
                stdio: ["ignore", "inherit", "inherit"],
            },
        );

        const {exitCode} = await waitForProcessExitWithAnyCode(subprocess);

        if (exitCode !== 0) {
            throw new UnknownError(
                `D1 migration application failed with exit code ${exitCode} for database ${databaseName}`,
            );
        }
    });
}

/**
 * Deploy Cloudflare by running `bazel run //server/edge:wrangler -- deploy`.
 * Should behave the same as if you run it locally. Except locally to authenticate
 * you need to run `bazel run //server/edge:wrangler -- login`.
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
    const env = {
        ...getProcessEnvToPropagate(),
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: workersToken,
    };

    await deployCloudflareWorkerWithRetry(
        context,
        "Edge Service",
        joinPath(runfilesPath, "cyberworlds/server/edge/wrangler.sh"),
        env,
    );

    await deployCloudflareWorkerWithRetry(
        context,
        "Agent Service",
        joinPath(runfilesPath, "cyberworlds/server/agents/bots/wrangler.sh"),
        env,
    );

    await applyCloudflareD1Migrations(
        context,
        "agent-usage",
        joinPath(runfilesPath, "cyberworlds/server/agents/bots/wrangler.sh"),
        env,
    );

    await deployCloudflareWorkerWithRetry(
        context,
        "Resource Service",
        joinPath(runfilesPath, "cyberworlds/server/resources/wrangler.sh"),
        env,
    );

    await deployCloudflareWorkerWithRetry(
        context,
        "Local Redirect Service",
        joinPath(runfilesPath, "cyberworlds/admin/local_redirect/wrangler.sh"),
        env,
    );

    await withTemporaryDirectory(
        os.tmpdir(),
        "cyberworlds_agent_v2_deploy_",
        async temporaryDirectoryPath => {
            await fs.mkdir(joinPath(temporaryDirectoryPath, "sandbox"));

            // Docker does not follow Bazel runfile symlinks outside of its build context. Copy
            // the container inputs to a temporary directory just like the dev server does
            // before running Wrangler so Docker receives regular files in the sandbox
            // directory.
            for (const relativePath of [
                "wrangler.toml",
                "agent_v2_service_bundle.js",
                "sandbox/claude_agent.dockerfile",
                "sandbox/claude_agent_service_bundle.mjs",
                "sandbox/sandbox_skills.tar.gz",
            ]) {
                await fs.copyFile(
                    joinPath(runfilesPath, "cyberworlds/server/agents/bots_v2", relativePath),
                    joinPath(temporaryDirectoryPath, relativePath),
                );
            }

            await deployCloudflareWorkerWithRetry(
                context,
                "Agent V2 Service",
                joinPath(runfilesPath, "cyberworlds/server/agents/bots_v2/wrangler.sh"),
                {
                    ...env,
                    JS_BINARY__CHDIR: temporaryDirectoryPath,
                },
            );
        },
    );
}
