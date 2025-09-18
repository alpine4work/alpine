import {Handler, Context as LambdaContext, SQSEvent, SQSRecord} from "aws-lambda";
import {ServerSecrets} from "~/server/aws/server_secrets_schema.js";
import {DynamoSystemActorContextModule} from "~/server/context/dynamo_actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobDescription, getJobDescriptionSpaceId} from "~/server/jobs/core/job_description.js";
import {JobQueueMessageBody, JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {createLambdaTracerAndHoneycombClient} from "~/server/lambda/helpers/create_lambda_tracer_and_honeycomb_client.js";
import {
    LambdaActionContext,
    LambdaActionContextModules,
    LambdaActionContextOptions,
    createLambdaActionContext,
    getLambdaActionContextOptions,
} from "~/server/lambda/helpers/lambda_action_context.js";
import {withLambdaTimeout} from "~/server/lambda/helpers/with_lambda_timeout.js";
import {createServiceTokenAgent} from "~/server/node/create_service_token_agent.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type BatchItemFailures = Array<{itemIdentifier: string}>;

const honeycombApiKey =
    process.env.NODE_ENV !== "production"
        ? process.env.HONEYCOMB_API_KEY
        : assertExists(process.env.HONEYCOMB_API_KEY, "HONEYCOMB_API_KEY is required");

export type LambdaSystemActionContext = Context<
    LambdaActionContextModules & {actor: DynamoSystemActorContextModule}
>;
export function createLambdaJobQueueConsumerHandler<TJobDescription extends JobDescription>({
    processJob,
    serviceName,
    serviceSecretsSchema,
}: {
    processJob: (
        context: LambdaSystemActionContext,
        job: TJobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;
    serviceName: TokenServiceName;
    serviceSecretsSchema: Schema<ServerSecrets>;
}): Handler<SQSEvent, {batchItemFailures: BatchItemFailures}> {
    const awsSigner = new AwsRequestSigner();
    let tokenAgentAndOptionsPromise: Promise<{
        tokenAgent: TokenAgent;
        options: LambdaActionContextOptions;
    }> | null = null;

    return async (event: SQSEvent, lambdaContext: LambdaContext) => {
        const promiseWaiter = new PromiseWaiter();
        let parentSpan: TracerSpan | null = null;
        let finishParentSpan: (() => void) | null = null;

        try {
            const [tracer] = createLambdaTracerAndHoneycombClient({
                serviceName,
                jsHost: "Node",
                promiseWaiter,
                honeycombApiKey,
            });
            ({span: parentSpan, finishSpan: finishParentSpan} = tracer.startSpan(
                lambdaContext.functionName,
            ));

            tokenAgentAndOptionsPromise ??= parentSpan.withSpan(
                "Allocate token agent and context options",
                async childSpan =>
                    getLambdaActionContextOptions(serviceSecretsSchema, childSpan).then(
                        async options => {
                            const tokenAgent = await childSpan.withSpan(
                                "Creating token agent",
                                async () =>
                                    await createServiceTokenAgent({
                                        serviceName: serviceName,
                                        options,
                                    }),
                            );
                            return {tokenAgent, options};
                        },
                    ),
            );
            const {tokenAgent, options} = await tokenAgentAndOptionsPromise;

            assert(event.Records.length === 1, "Batch size must be 1");
            const record = event.Records[0]!;

            const actionContext = createLambdaActionContext({
                awsSigner,
                options,
                promiseWaiter,
                span: parentSpan,
                tokenAgent,
                tracer,
            });

            const batchItemFailures: BatchItemFailures = [];
            try {
                await _processJob(actionContext, processJob, {
                    record,
                    parentSpan,
                    lambdaContext,
                    serviceName,
                });
            } catch (error) {
                parentSpan.addException(error);
                batchItemFailures.push({itemIdentifier: record.messageId});
            } finally {
                return {
                    batchItemFailures,
                };
            }
        } catch (error) {
            if (parentSpan) {
                parentSpan.addException(error);
            } else {
                // NOTE(ifitzsimmons, 2025-09-05): If we failed to handle the request due to
                // resource allocation issues, we want to log an error to Cloudwatch. Theoretically,
                // this should never happen, but this will help us debug the issue.
                // eslint-disable-next-line no-console
                console.error("Error outside of SQS subscription handler:", error);
            }

            // NOTE(ifitzsimmons, 2025-09-08): In this case, the error has occurred before even
            // processing the request, which might indicate that there's a problem with the runtime
            // environment. An error here will force the Lambda lifecycle to kill this container so
            // that it's execution environment is not reused.
            throw error;
        } finally {
            await finishSpanAndFlushHoneycombEvents(finishParentSpan, promiseWaiter);
        }
    };
}

async function _processJob<TJobDescription extends JobDescription>(
    actionContext: LambdaActionContext,
    processJob: (
        context: LambdaSystemActionContext,
        job: TJobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>,
    {
        record,
        parentSpan,
        serviceName,
        lambdaContext,
    }: {
        record: SQSRecord;
        parentSpan: TracerSpan;
        serviceName: TokenServiceName;
        lambdaContext: LambdaContext;
    },
): Promise<void> {
    let span: TracerSpan | undefined;
    let finishSpan: (() => void) | undefined;
    let messageBodyForError: JobQueueMessageBody | undefined;
    try {
        const serializedMessageBody = JSON.parse(assertExists(record.body));

        const messageBody = JobQueueMessageBodySchema.deserialize(serializedMessageBody);
        assert(
            messageBody.type === "Regular",
            quote`Maintenance jobs are not supported: ${messageBody.job.type}`,
        );

        messageBodyForError = messageBody;

        const {spanName, handleSpanName} = getHandleSpanName(messageBody);

        ({span, finishSpan} =
            messageBody.tracerContext !== null
                ? actionContext.tracer
                      .getRoot()
                      .startSpanFromPropagationContextAsLinked(spanName, messageBody.tracerContext)
                : actionContext.tracer.getRoot().startSpan(spanName));

        parentSpan.link(`Execution: ${handleSpanName}`, span);

        // The time at which the job starts to be available for processing. The send
        // time plus delay seconds. This will be a little earlier than when the job is
        // truly available for processing since we don't include the latency of adding
        // a job to SQS.
        const jobStartTime =
            messageBody.delaySeconds === 0
                ? messageBody.sendTime
                : new Date(messageBody.sendTime.getTime() + messageBody.delaySeconds * 1000);

        span.addData({
            aws: {sqs: {messageId: record.messageId, messageCount: 1}},
            jobs: {
                type: messageBody.job.type,
                delaySeconds: messageBody.delaySeconds,
                queueDurationMs:
                    span.clock.now() -
                    // Don't include the delay in queue duration (use start time instead of send
                    // time). The delay is intentional. We want to measure overall queue health.
                    // Ideally the queue duration should be as close to zero as possible.
                    jobStartTime.getTime(),
            },
        });

        span.addPropagatedDataForChildrenOnly({
            context: {
                handler: handleSpanName,
            },
        });

        const spaceId = getJobDescriptionSpaceId(messageBody.job);

        span.addPropagatedData({context: {spaceId}});

        await actionContext.with(
            {
                actor: DynamoSystemActorContextModule.dangerouslyNew(serviceName, spaceId),
            },
            context =>
                withLambdaTimeout(lambdaContext, new AbortController(), async () =>
                    // TODO(ifitzsimmons, 2025-09-16): Update processJob signature to include the
                    // abort controller.
                    processJob(context, messageBody.job as TJobDescription, jobStartTime, span!),
                ),
        );
        finishSpan();
    } catch (error) {
        // When there's an error processing a job in development, log an error so the
        // developer can see it in the console since they might not see it in the UI.
        if (process.env.NODE_ENV !== "production") {
            if (messageBodyForError === undefined) {
                // eslint-disable-next-line no-console
                console.error("Job processing failed:", error);
            } else {
                // eslint-disable-next-line no-console
                console.error(quote`Job ${messageBodyForError.job.type} processing failed:`, error);
            }
        }

        if (span) {
            assert(finishSpan);
            span.addData({jobs: {willRetry: true}});
            span.addException(error);
            finishSpan();
        } else {
            actionContext.tracer.getTracer().getRoot().logException("Job parsing failed", error);
        }

        throw error;
    }
}

async function finishSpanAndFlushHoneycombEvents(
    finishSpan: (() => void) | null,
    promiseWaiter: PromiseWaiter,
) {
    finishSpan?.();
    await promiseWaiter.wait();
}

function getHandleSpanName(messageBody: JobQueueMessageBody) {
    let handleSpanName = `Process job ${messageBody.job.type}`;

    // For jobs that process many different things, include the subtype in the
    // name to help identify the span.
    switch (messageBody.job.type) {
        case "NotificationEvent": {
            handleSpanName += ` (${messageBody.job.event.type})`;
            break;
        }
        case "IndexSearchEntity":
        case "IndexSearchEntityDependents": {
            handleSpanName += ` (${messageBody.job.update.type})`;
            break;
        }
        case "IndexSearchEntityEmbeddingChunks": {
            handleSpanName += ` (${messageBody.job.entityId.split(":", 2)[0]})`;
            break;
        }
        // TODO(ifitzsimmons, 2025-09-16): Add other file processors here
        case "ProcessFile": {
            handleSpanName += ` (${messageBody.job.contentType})`;
            break;
        }
    }

    return {spanName: `Handle: ${handleSpanName}`, handleSpanName};
}
