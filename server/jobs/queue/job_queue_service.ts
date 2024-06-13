import fs from "fs-extra";
import {
    DynamoActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {ApnsContextModule} from "~/server/apns/apns_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {JobQueueConsumer} from "~/server/jobs/queue/job_queue_consumer.js";
import {
    JobQueueSystemActionContext,
    JobQueueSystemActionContextModules,
    MaintenanceJobQueueSystemActionContextModules,
} from "~/server/jobs/queue/job_queue_system_action_context.js";
import {processJob} from "~/server/jobs/queue/process_job.js";
import {processMaintenanceJob} from "~/server/jobs/queue/process_maintenance_job.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
    serviceTokenAgentParseOptions,
} from "~/server/node/create_service_token_agent.js";
import {runService} from "~/server/node/run_service.js";
import {
    registerShutdownListener,
    registerShutdownListenerForIngressTraffic,
} from "~/server/node/shutdown_manager.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {TaskRealtimeServiceEcsRouter} from "~/server/tasks/data/task_realtime_service_ecs_router.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/data/task_realtime_service_local_router.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

runService({
    serviceName: "JobQueueService",
    options: {
        allMiniLmL6V2LanguageModel: {type: "string"},
        cohereApiKey: {type: "string"},
        taskRealtimeServiceLocalPort: {type: "string"},
        ecsCluster: {type: "string"},
        taskRealtimeServiceEcsTaskDefinitionFamily: {type: "string"},
        apnsCertificate: {type: "string"},
        apnsCertificatePrivateKey: {type: "string"},
        ...serviceTokenAgentParseOptions,
        ...serverProcessContextParseOptions,
    },
    run: async ({options, tracer}) => {
        const jobQueueUrl = assertExists(options.jobQueueUrl, "Missing `jobQueueUrl` option");

        // In development, wait for our local SQS server to start before starting
        // the `JobQueueService`.
        {
            const parsedJobQueueUrl = new URL(jobQueueUrl);
            if (parsedJobQueueUrl.hostname === "localhost") {
                await waitForHttpServer(parseInt(parsedJobQueueUrl.port, 10));
            }
        }

        const [tokenAgent, apnsCertificate, apnsCertificatePrivateKey] = await runAllPromises([
            createServiceTokenAgent({
                serviceName: "JobQueueService",
                options,
            }),
            getServiceTokenAgentKeyFromOption(
                assertExists(options.apnsCertificate, "Missing `apnsCertificate` option"),
            ),
            getServiceTokenAgentKeyFromOption(
                assertExists(
                    options.apnsCertificatePrivateKey,
                    "Missing `apnsCertificatePrivateKey` option",
                ),
            ),
        ]);

        const awsSigner = new AwsRequestSigner();

        const languageModel =
            process.env.NODE_ENV === "production"
                ? new CohereEmbedEnglishV3LanguageModel({
                      apiKey: assertExists(
                          options.cohereApiKey,
                          "`cohereApiKey` option is required in production",
                      ),
                  })
                : await AllMiniLmL6V2LanguageModel.new(
                      assertExists(
                          options.allMiniLmL6V2LanguageModel,
                          "`allMiniLmL6V2LanguageModel` option is required in development",
                      ),
                  );

        const processContext = createServerProcessContext({
            tracer,
            tokenAgent,
            awsSigner,
            options,
        }).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        });

        const apnsConnectionPool = new ApnsConnectionPool(processContext, {
            certificate: apnsCertificate,
            certificatePrivateKey: apnsCertificatePrivateKey,
        });

        registerShutdownListener(async () => {
            await apnsConnectionPool.destroy();
        });

        const apnsContextModule = new ApnsContextModule(apnsConnectionPool);

        const taskRealtimeServiceRouter =
            process.env.NODE_ENV === "production"
                ? new TaskRealtimeServiceEcsRouter({
                      region: "us-east-1",
                      ecsCluster: assertExists(
                          options.ecsCluster,
                          "`ecsCluster` option is required in production",
                      ),
                      ecsTaskDefinitionFamily: assertExists(
                          options.taskRealtimeServiceEcsTaskDefinitionFamily,
                          "`taskRealtimeServiceEcsTaskDefinitionFamily` option is required in production",
                      ),
                  })
                : new TaskRealtimeServiceLocalRouter({
                      port: parseInt(
                          assertExists(
                              options.taskRealtimeServiceLocalPort,
                              "Task realtime service local port must be provided when running locally",
                          ),
                          10,
                      ),
                  });

        const consumer = JobQueueConsumer.start(processContext, {
            region: "us-east-1",
            queueUrl: jobQueueUrl,
            processJob: (_actionContext, job, jobStartTime, span) => {
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
                                tokenAgent,
                                router: taskRealtimeServiceRouter,
                                dangerouslyEscalateToSystemContext,
                            }),
                            apns: apnsContextModule,
                        },
                        action,
                    );
                };

                const actionContext = _actionContext.clone<
                    Omit<JobQueueSystemActionContextModules, keyof ServerSystemActionContextModules>
                >({
                    tasks: new TaskContextModule({
                        tokenAgent,
                        router: taskRealtimeServiceRouter,
                        dangerouslyEscalateToSystemContext,
                    }),
                    apns: apnsContextModule,
                });

                return processJob(actionContext, job, jobStartTime, span);
            },
            processMaintenanceJob: (_actionContext, job, jobStartTime, span) => {
                // Maintenance jobs have access to all spaces, so this is actually a
                // de-escalation of permissions. But we still need the function for
                // compatibility.
                //
                // It's important we use new caches + batchers here. We don't want to load some
                // data at a higher permission level then let the session context see it. So we
                // derive our new context from the process context to help avoid reusing any
                // request-level caches.
                const dangerouslyEscalateToSystemContext = <Value>(
                    context: Context<{
                        tracer: TracerContextModule;
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
                                // Maintenance jobs don't have an actor. Escalating to a system context isn't
                                // actually dangerous, it's a de-escalation of permission. Say our actor's
                                // source is the job queue service.
                                "JobQueueService",
                                spaceId,
                            ),
                            tasks: new TaskContextModule({
                                tokenAgent,
                                router: taskRealtimeServiceRouter,
                                dangerouslyEscalateToSystemContext,
                            }),
                            apns: apnsContextModule,
                        },
                        action,
                    );
                };

                const actionContext = _actionContext.clone<
                    Omit<
                        MaintenanceJobQueueSystemActionContextModules,
                        keyof ServerSystemActionContextModules
                    >
                >({
                    tasks: new TaskContextModule({
                        tokenAgent,
                        router: taskRealtimeServiceRouter,
                        dangerouslyEscalateToSystemContext,
                    }),
                });

                return processMaintenanceJob(actionContext, job, jobStartTime, span);
            },
        });

        registerShutdownListenerForIngressTraffic(async () => {
            await consumer.stop();
        });

        // In production, we communicate that our process is healthy by writing to a
        // healthcheck file.
        if (process.env.NODE_ENV === "production") {
            await fs.writeFile("/var/www-data/server_jobs_queue_healthcheck.txt", "Healthy\n");
        }

        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Waiting for jobs from queue (pid ${process.pid})`);
        }
    },
});
