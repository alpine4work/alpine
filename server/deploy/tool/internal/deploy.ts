import {
    cleanupDeploy,
    githubOwner,
    githubRepo,
    prepareDeploy,
} from "~/server/deploy/data/deploy_table.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {CloudflareR2ContextModule} from "~/server/deploy/tool/internal/cloudflare_r2_context_module.js";
import {
    cleanupAppStaticFilesAfterDeploy,
    uploadAppStaticFilesBeforeDeploy,
} from "~/server/deploy/tool/internal/deploy_app_static_files.js";
import {deployAwsCdk} from "~/server/deploy/tool/internal/deploy_aws_cdk.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Run a deploy.
 *
 * This function is written to work in `DeployService` and nowhere else. It
 * looks for runfiles declared as dependencies of `DeployService`. It uses the
 * `git` CLI which is only available in GitHub action runners. Trying to call
 * this function from anywhere but `DeployService` will likely fail.
 */
export async function deploy(
    context: Context<
        DynamoContextModules & {
            github: GithubContextModule;
            cloudflareR2: CloudflareR2ContextModule;
        }
    >,
    {
        commitSha,
        workflowRunId,
        workflowRunAttempt,
    }: {
        commitSha: string;
        workflowRunId: number;
        workflowRunAttempt: number;
    },
): Promise<void> {
    const tracer = context.tracer.getRoot();

    const handleSpanName = "Deploy";
    const clock = new MonotonicClock(tracer.getNonMonotonicClock());

    // Request without tracing since we need the result of this request to
    // initialize our trace with the correct start time.
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
                    attempt: workflowRunAttempt,
                    url: `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${workflowRunId}`,
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
                !workflowRunJobStep.completed_at
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

        await context.with({tracer: new TracerContextModule(rootSpan)}, context =>
            actuallyDeploy(context, {
                commitSha,
                workflowRunId,
            }),
        );

        finishRootSpan();
    } catch (error) {
        rootSpan.addException(error);
        finishRootSpan();
        throw error;
    }

    return context.tracer.withSpan(`Handle: ${handleSpanName}`, (context, span) => {
        span.addPropagatedDataForChildrenOnly({context: {handler: handleSpanName}});
        return actuallyDeploy(context, {commitSha, workflowRunId});
    });
}

async function actuallyDeploy(
    context: Context<
        DynamoContextModules & {
            github: GithubContextModule;
            cloudflareR2: CloudflareR2ContextModule;
        }
    >,
    {
        commitSha,
        workflowRunId,
    }: {
        commitSha: string;
        workflowRunId: number;
    },
) {
    const deployItem = await context.tracer.withSpan("Prepare deploy", context =>
        prepareDeploy(context, {
            commitSha,
            workflowRunId,
        }),
    );

    const result = await captureResultPromise(async () => {
        const {manifest, paths} = await context.tracer.withSpan(
            "Upload app static files",
            context => uploadAppStaticFilesBeforeDeploy(context),
        );

        await context.tracer.withSpan("Deploy AWS CDK", () => deployAwsCdk());

        // TODO(calebmer, #deploy): I stashed the changes that serve Cloudflare R2
        // files in production. Get the stash back and run a deploy.

        // TODO(calebmer, #deploy): Cloudflare Workers deploy with `wrangler`.

        await context.tracer.withSpan("Cleanup app static files", context =>
            cleanupAppStaticFilesAfterDeploy(context, {manifest, paths}),
        );

        // TODO(calebmer, #deploy): Add marker to Honeycomb at start or end of deploy.
    });

    await cleanupDeploy(context, {
        commitSha,
        workflowRunId,
        result,
        initialItem: deployItem,
    });

    unwrapResult(result);
}
