import {
    DynamoActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobQueueConsumer} from "~/server/jobs/queue/job_queue_consumer.js";
import {
    JobQueueSystemActionContext,
    JobQueueSystemActionContextModules,
} from "~/server/jobs/queue/job_queue_system_action_context.js";
import {processJob} from "~/server/jobs/queue/process_job.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {runService} from "~/server/node/run_service.js";
import {registerShutdownListenerForIngressTraffic} from "~/server/node/shutdown_manager.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Implement `JobQueueService`.

runService({
    serviceName: "JobQueueService",
    options: {
        ...serverProcessContextParseOptions,
    },
    run: async ({options, tracer}) => {
        const awsSigner = new AwsRequestSigner();

        const processContext = createServerProcessContext({tracer, awsSigner, options});

        const consumer = JobQueueConsumer.start(processContext, {
            // @ts-expect-error: NOCOMMIT
            queueUrl,
            processJob: (_actionContext, job, jobStartTime) => {
                // Jobs are already processed in a system context so this isn't actually an
                // escalation but we still need it for compatibility.
                //
                // It's important we use new caches + batchers here. We don't want to load some
                // data at a higher permission level then let the session context see it. So we
                // derive our new context from the process context to help avoid reusing any
                // request-level caches.
                const dangerouslyEscalateToSystemContext = <Value>(
                    context: Context<{
                        tracer: TracerContextModule;
                        actor: DynamoActorContextModule;
                        cache: CacheContextModule;
                    }>,
                    spaceId: SpaceId,
                    action: (context: JobQueueSystemActionContext) => Promise<Value>,
                ): Promise<Value> => {
                    return processContext.with<
                        Omit<
                            JobQueueSystemActionContextModules,
                            Exclude<keyof ServerProcessContextModules, "tracer">
                        >,
                        Value
                    >(
                        {
                            tracer: new TracerContextModule(context.tracer.getTracer()),
                            // Optimization: Share some caches that opt-in to sharing with the session
                            // context. This is dangerous since we don't want to let system data leak into
                            // session actions and vice-versa. We trust the cache author to make the right
                            // determination about their cache.
                            cache: context.cache.dangerouslyForkWithSharedCaches(),
                            dynamoBatchContext: new DynamoBatchContextModule(),
                            actor: DynamoSystemActorContextModule.dangerouslyNew(
                                context.actor.serviceName,
                                spaceId,
                            ),
                            tasks: new TaskContextModule({
                                // @ts-expect-error: NOCOMMIT
                                tokenAgent,
                                // @ts-expect-error: NOCOMMIT
                                router,
                                dangerouslyEscalateToSystemContext,
                            }),
                        },
                        action,
                    );
                };

                const actionContext = _actionContext.clone<
                    Omit<JobQueueSystemActionContextModules, keyof ServerSystemActionContextModules>
                >({
                    tasks: new TaskContextModule({
                        // @ts-expect-error: NOCOMMIT
                        tokenAgent,
                        // @ts-expect-error: NOCOMMIT
                        router,
                        dangerouslyEscalateToSystemContext,
                    }),
                });

                return processJob(actionContext, job, jobStartTime);
            },
        });

        registerShutdownListenerForIngressTraffic(async () => {
            consumer.stop();
        });
    },
});
