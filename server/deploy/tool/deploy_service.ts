import createEnvPaths from "env-paths";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {
    cleanupDeployFromWorkflow,
    prepareDeployFromWorkflow,
} from "~/server/deploy/data/deploy_table.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {runService} from "~/server/node/run_service.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const envPaths = createEnvPaths("cyberworlds-deploy", {suffix: ""});

const DeployStateSchema = Schema.object({
    commitSha: Schema.string,
    workflowRunId: Schema.integer,
    traceId: Schema.id<TraceId>(),
    rootSpanId: Schema.id<TraceSpanId>(),
    startTime: Schema.float,
    prepareEndTime: Schema.float,
});

runService({
    serviceName: "DeployService",
    withoutCluster: true,
    options: {
        action: {type: "string"},
        status: {type: "string"},
        commitSha: {type: "string"},
        workflowRunId: {type: "string"},
        ...serverProcessContextParseOptions,
    },
    run: async ({
        tracer,
        options: {action, status, commitSha, workflowRunId: workflowRunIdString, ...options},
    }) => {
        if (action === undefined) throw new InvalidArgumentError('"action" option is required');
        if (commitSha === undefined)
            throw new InvalidArgumentError('"commitSha" option is required');
        if (workflowRunIdString === undefined || !/^[0-9]+$/.test(workflowRunIdString))
            throw new InvalidArgumentError('"workflowRunId" integer option is required');

        const workflowRunId = parseInt(workflowRunIdString, 10);

        const awsSigner = new AwsRequestSigner();

        const processContext = createServerProcessContext({
            tracer,
            // TODO(calebmer, 2024-08-05): The deploy service doesn't currently communicate
            // with any other services but might in the future. I need to decide whether or
            // not the server process context should contain context modules to communicate
            // with other services like `edge`. Maybe there should be a second limited
            // server process context type that doesn't need access to other services.
            tokenAgent: "Unimplemented",
            awsSigner,
            options,
        });

        switch (action) {
            case "Prepare": {
                const traceId = generateId<TraceId>();
                const rootSpanId = generateId<TraceSpanId>();

                const clock = new MonotonicClock(tracer.getNonMonotonicClock());

                const startTime = clock.now();

                try {
                    const {span, finishSpan} = TracerSpan._start(tracer, clock, "Prepare deploy", {
                        traceId,
                        parentId: rootSpanId,
                    });
                    try {
                        await prepareDeployFromWorkflow(
                            processContext.clone({
                                tracer: new TracerContextModule(span),
                                github: new GithubContextModule(),
                            }),
                            {commitSha, workflowRunId},
                        );
                        finishSpan();
                    } catch (error) {
                        span.addException(error);
                        finishSpan();
                        throw error;
                    }
                } finally {
                    const prepareEndTime = clock.now();

                    await fs.ensureDir(envPaths.data);
                    await fs.writeFile(
                        joinPath(envPaths.data, "deploy_state.json"),
                        JSON.stringify(
                            DeployStateSchema.serialize({
                                commitSha,
                                workflowRunId,
                                traceId,
                                rootSpanId,
                                startTime,
                                prepareEndTime,
                            }),
                        ),
                    );
                }
                break;
            }
            case "Cleanup": {
                if (status !== "Success" && status !== "Failure") {
                    throw new InvalidArgumentError(
                        '"status" option is required and must be "Success" or "Failure"',
                    );
                }

                const deployState = DeployStateSchema.deserialize(
                    JSON.parse(
                        await fs.readFile(joinPath(envPaths.data, "deploy_state.json"), "utf8"),
                    ),
                );

                if (deployState.workflowRunId !== workflowRunId) {
                    throw new InternalError(
                        quote`Unexpected deploy state workflow run (expected id: ${workflowRunId}, actual id: ${deployState.workflowRunId})`,
                    );
                }

                if (deployState.commitSha !== commitSha) {
                    throw new InternalError(
                        quote`Unexpected deploy state commit (expected commit: ${commitSha}, actual commit: ${deployState.commitSha})`,
                    );
                }

                const {traceId, rootSpanId, startTime, prepareEndTime} = deployState;

                const clock = new MonotonicClock(tracer.getNonMonotonicClock());

                // Send a span that only covers the AWS CDK deploy. Which starts at the end of
                // our prepare call and ends at the start of our cleanup call.
                {
                    const {finishSpan} = TracerSpan._start(
                        tracer,
                        clock,
                        "AWS CDK deploy",
                        {traceId, parentId: rootSpanId},
                        generateId<TraceSpanId>(),
                        prepareEndTime,
                    );
                    finishSpan();
                }

                // Actually run cleanup...
                try {
                    const {span, finishSpan} = TracerSpan._start(tracer, clock, "Cleanup deploy", {
                        traceId,
                        parentId: rootSpanId,
                    });
                    try {
                        await cleanupDeployFromWorkflow(
                            processContext.clone({
                                tracer: new TracerContextModule(span),
                                github: new GithubContextModule(),
                            }),
                            {commitSha, workflowRunId, status},
                        );
                        finishSpan();
                    } catch (error) {
                        span.addException(error);
                        finishSpan();
                        throw error;
                    }
                } finally {
                    // Send a span that covers the entire deploy including prepare/cleanup. The
                    // span ends here now that we have nothing else to do.
                    const {finishSpan} = TracerSpan._start(
                        tracer,
                        clock,
                        "Deploy",
                        {traceId},
                        rootSpanId,
                        startTime,
                    );
                    finishSpan();
                }
                break;
            }
            default:
                throw new InvalidArgumentError(quote`Unexpected "action" option: ${action}`);
        }
    },
});
