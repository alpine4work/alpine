import {addMinutes, subMinutes} from "date-fns";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    cleanupDeploy,
    githubOwner,
    githubRepo,
    prepareDeploy,
} from "~/server/deploy/data/deploy_actions.js";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {
    cleanupAppStaticFilesAfterDeploy,
    uploadAppStaticFilesBeforeDeploy,
} from "~/server/deploy/script/internal/deploy_app_static_files.js";
import {deployAws} from "~/server/deploy/script/internal/deploy_aws.js";
import {deployCloudflareWorkers} from "~/server/deploy/script/internal/deploy_cloudflare_workers.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {TracerClient} from "~/server/tracer/tracer_client.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnavailableError, UnknownError} from "~/shared/error/error.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

const honeycombTeam = "cyberworlds";

/**
 * Run a deploy.
 *
 * This function is written to work in `DeployService` and nowhere else. It looks
 * for runfiles declared as dependencies of `DeployService`. It uses the `git` CLI
 * which is only available in GitHub action runners. Trying to call this function
 * from anywhere but `DeployService` will likely fail.
 */
export async function deploy(
    context: Context<
        DynamoContextModules & {
            jobs: JobsContextModule;
            github: GithubContextModuleBase;
            r2: CloudflareR2ContextModule;
        }
    >,
    {
        commitSha,
        workflowRunId,
        workflowRunNumber,
        workflowRunAttempt,
        honeycombClient,
        cloudflareAccountId,
        cloudflareWorkersToken,
    }: {
        commitSha: string;
        workflowRunId: number;
        workflowRunNumber: number;
        workflowRunAttempt: number;
        honeycombClient: TracerClient;
        cloudflareAccountId: string;
        cloudflareWorkersToken: string;
    },
): Promise<void> {
    const tracer = context.tracer.getRoot();

    const handleSpanName = "Deploy";
    const clock = new MonotonicClock(tracer.getNonMonotonicClock());

    // Request without tracing since we need the result of this request to initialize
    // our trace with the correct start time.
    const workflowRunJobsOutput = await context.github.quietlyRequestWithoutTracing(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs",
        {
            owner: githubOwner,
            repo: githubRepo,
            run_id: workflowRunId,
            attempt_number: workflowRunAttempt,
        },
    );
    assert(workflowRunJobsOutput.data.total_count === 1);
    const workflowRunJob = assertExists(workflowRunJobsOutput.data.jobs[0]);

    const traceId = generateId<TraceId>();
    const rootSpanId = generateId<TraceSpanId>();

    const {span: rootSpan, finishSpan: finishRootSpan} = TracerSpan._start(
        tracer,
        clock,
        `Handle: ${handleSpanName}`,
        {traceId},
        rootSpanId,
        new Date(workflowRunJob.started_at).getTime(),
    );

    rootSpan.addData({
        github: {
            workflow: {
                run: {
                    id: workflowRunId,
                    number: workflowRunNumber,
                    attempt: workflowRunAttempt,
                    url: `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${workflowRunId}`,
                    commit: commitSha,
                },
            },
        },
    });

    try {
        rootSpan.addPropagatedDataForChildrenOnly({context: {handler: handleSpanName}});

        for (const workflowRunJobStep of workflowRunJob.steps ?? []) {
            if (
                workflowRunJobStep.conclusion === null ||
                !workflowRunJobStep.started_at ||
                !workflowRunJobStep.completed_at ||
                // Ignore skipped steps entirely. They'll have a duration of 0s.
                workflowRunJobStep.conclusion === "skipped"
            ) {
                continue;
            }

            const {span, finishSpan} = TracerSpan._startWithEndTime(
                tracer,
                clock,
                workflowRunJobStep.name,
                {
                    traceId,
                    parentId: rootSpanId,
                    propagatedEventData: rootSpan._getPropagatedEventData(),
                    propagatedEventFlatData: rootSpan._getPropagatedEventFlatData(),
                },
                generateId<TraceSpanId>(),
                new Date(workflowRunJobStep.started_at).getTime(),
            );

            if (workflowRunJobStep.conclusion !== "success") {
                span.addException(
                    new UnknownError(
                        quote`Job step completed with ${workflowRunJobStep.conclusion}`,
                    ),
                );
            }

            finishSpan(new Date(workflowRunJobStep.completed_at).getTime());
        }

        await rootSpan.withSpan("Deploy", span =>
            context.with({tracer: new TracerContextModule(span)}, context =>
                actuallyDeploy(context, {
                    rootSpan,
                    commitSha,
                    workflowRunId,
                    workflowRunNumber,
                    honeycombClient,
                    cloudflareAccountId,
                    cloudflareWorkersToken,
                }),
            ),
        );

        finishRootSpan();
    } catch (error) {
        rootSpan.addException(error);
        finishRootSpan();
        throw error;
    }
}

async function actuallyDeploy(
    context: Context<
        DynamoContextModules & {
            jobs: JobsContextModule;
            github: GithubContextModuleBase;
            r2: CloudflareR2ContextModule;
        }
    >,
    {
        rootSpan,
        commitSha,
        workflowRunId,
        workflowRunNumber,
        honeycombClient,
        cloudflareAccountId,
        cloudflareWorkersToken,
    }: {
        rootSpan: TracerSpan;
        commitSha: string;
        workflowRunId: number;
        workflowRunNumber: number;
        honeycombClient: TracerClient;
        cloudflareAccountId: string;
        cloudflareWorkersToken: string;
    },
) {
    const deployItem = await context.tracer.withSpan("Prepare deploy", context =>
        prepareDeploy(context, {
            commitSha,
            workflowRunId,
        }),
    );

    const deployStartTime = new Date();

    const githubCompareUrl = `https://github.com/${githubOwner}/${githubRepo}/compare/${deployItem.activeCommitSha}...${commitSha}`;
    const honeycombTraceUrl = `https://ui.honeycomb.io/${honeycombTeam}/environments/production/trace?trace_id=${
        rootSpan.traceId
    }&trace_start_ts=${Math.round(
        subMinutes(deployStartTime, 60).getTime() / 1000,
    )}&trace_end_ts=${Math.round(addMinutes(deployStartTime, 60).getTime() / 1000)}`;

    rootSpan.addData({
        deploy: {
            activeCommit: deployItem.activeCommitSha,
        },
        github: {
            compareUrl: githubCompareUrl,
        },
    });

    // These notices are added as annotations to the GitHub actions run deploy
    // page. Allows you to quickly see what code was updated in a given deploy and
    // lets you see the Honeycomb trace.
    //
    // eslint-disable-next-line no-console
    console.log(`::notice title=Compare::${githubCompareUrl}`);
    // eslint-disable-next-line no-console
    console.log(`::notice title=Trace::${honeycombTraceUrl}`);

    let hasAwsDeployFinished = false;

    const result = await captureResultPromise(async () => {
        const {manifest, paths} = await context.tracer.withSpan(
            "Upload app static files",
            context => uploadAppStaticFilesBeforeDeploy(context),
        );

        await context.tracer.withSpan("Deploy AWS", (context, span) => deployAws(span));

        // Our deploy table updates `deployItem.commitSha` once the AWS deploy is done.
        // Since after the AWS deploy if the deploy fails we won't rollback our changes to
        // AWS.
        //
        // We should consider deploying to Cloudflare (and uploading static files) within
        // CloudFormation to get proper rollback handling when a Cloudflare deploy fails.
        // Right now if the Cloudflare deploy fails the AWS deploy stays in production but
        // Cloudflare continues to run old code.
        hasAwsDeployFinished = true;

        await context.tracer.withSpan("Deploy Cloudflare Workers", () =>
            deployCloudflareWorkers(context, {
                accountId: cloudflareAccountId,
                workersToken: cloudflareWorkersToken,
            }),
        );

        await context.tracer.withSpan("Cleanup app static files", context =>
            cleanupAppStaticFilesAfterDeploy(context, {manifest, paths}),
        );
    });

    const deployEndTime = new Date();

    // We've seen occasional transient failures when creating Honeycomb markers. Retry
    // 5xx errors (which throw UnavailableError) but not 4xx errors.
    await retryWithExponentialBackoff(async retry => {
        try {
            await honeycombClient.createMarker({
                type: "deploy",
                message: `Deploy #${workflowRunNumber}`,
                url: `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${workflowRunId}`,
                startTime: deployStartTime,
                endTime: deployEndTime,
            });
        } catch (error) {
            if (error instanceof UnavailableError) {
                throw retry(error);
            }

            throw error;
        }
    });

    await cleanupDeploy(context, {
        commitSha,
        workflowRunId,
        initialItem: deployItem,
        hasAwsDeployFinished,
    });

    unwrapResult(result);
}
