import {ChildProcess, spawn} from "child_process";
import {join as joinPath} from "path";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExitWithAnyCode} from "~/server/helpers/node/wait_for_process_exit.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";

const maxCloudflareDeployAttempts = 3;
const sleepBetweenAttemptsMs = 3000;

/**
 * Deploys a Cloudflare worker with retry logic for any errors.
 * Retries up to 2 times with a sleep between attempts.
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
// TODO(imjoshin): Ignoring to avoid overnight deploy breakage.
// There's a failure in this command somewhere, need to investigate.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            ["d1", "migrations", "apply", databaseName],
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
        joinPath(runfilesPath, "cyberworlds/server/agents/wrangler.sh"),
        env,
    );

    // TODO(imjoshin): Commenting to avoid overnight deploy breakage.
    // There's a failure in this command somewhere, need to investigate.
    // await applyCloudflareD1Migrations(
    //     context,
    //     "agent-usage",
    //     joinPath(runfilesPath, "cyberworlds/server/agents/wrangler.sh"),
    //     env,
    // );

    await deployCloudflareWorkerWithRetry(
        context,
        "Resource Service",
        joinPath(runfilesPath, "cyberworlds/server/resources/wrangler.sh"),
        env,
    );
}
