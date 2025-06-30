import {createAppAuth as createGithubAppAuth} from "@octokit/auth-app";
import fs from "fs-extra";
import {
    DynamoActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {
    ApnsContextModule,
    ApnsContextModuleBase,
    TestApnsContextModule,
} from "~/server/apns/apns_context_module.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {ContentContextModule} from "~/server/content/context_module/content_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {
    GithubContextModule,
    UnimplementedGithubContextModule,
} from "~/server/deploy/data/github_context_module.js";
import {
    SchedulerContextModule,
    UnimplementedSchedulerContextModule,
} from "~/server/deploy/data/scheduler_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {JobQueueConsumer} from "~/server/jobs/queue/consumer/job_queue_consumer.js";
import {
    JobQueueServiceProcessContext,
    JobQueueServiceProcessContextModules,
    JobQueueServiceSystemActionContext,
    JobQueueServiceSystemActionContextModules,
    MaintenanceJobQueueServiceSystemActionContextModules,
} from "~/server/jobs/queue/job_queue_service_context.js";
import {processJob} from "~/server/jobs/queue/process_job.js";
import {processMaintenanceJob} from "~/server/jobs/queue/process_maintenance_job.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {
    createServerProcessContext,
    serverProcessContextOptions,
} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
    serviceTokenAgentOptions,
} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {
    createServiceOpensearchContextModule,
    serviceOpensearchOptions,
} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {TaskRealtimeServiceEcsRouter} from "~/server/tasks/data/task_realtime_service_ecs_router.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/data/task_realtime_service_local_router.js";
import {EdgeServiceContextModule} from "~/server/tokens/edge_service_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    edgeServiceUrl: {type: "string"},
    allMiniLmL6V2LanguageModel: {type: "string"},
    cohereApiKey: {type: "string"},
    taskRealtimeServiceLocalPort: {type: "string"},
    ecsCluster: {type: "string"},
    taskRealtimeServiceEcsTaskDefinitionFamily: {type: "string"},
    taskRealtimeServiceSecurityGroupId: {type: "string"},
    apnsCertificate: {type: "string"},
    apnsCertificatePrivateKey: {type: "string"},
    jobQueueArn: {type: "string"},
    schedulerJobQueueRoleArn: {type: "string"},
    githubAppId: {type: "string"},
    githubAppPrivateKey: {type: "string"},
    githubAppClientId: {type: "string"},
    githubAppClientSecret: {type: "string"},
    githubAppInstallationId: {type: "string"},
    ...serviceTokenAgentOptions,
    ...serverProcessContextOptions,
    ...serviceOpensearchOptions,
    ...serviceCloudflareR2Options,
} as const;

export async function run({
    options,
    tracer,
    shutdownManager,
}: {
    options: Options;
    tracer: TracerRoot;
    shutdownManager: ShutdownManager;
}) {
    const jobQueueUrl = assertExists(options.jobQueueUrl, "Missing `jobQueueUrl` option");

    // In development, wait for our local SQS server to start before starting
    // the `JobQueueService`.
    {
        const parsedJobQueueUrl = new URL(jobQueueUrl);
        if (parsedJobQueueUrl.hostname === "localhost") {
            await waitForHttpServer(parseInt(parsedJobQueueUrl.port, 10));
        }
    }

    const [tokenAgent, apnsCertificate, apnsCertificatePrivateKey, githubAppPrivateKey] =
        await runAllPromises([
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
            options.githubAppPrivateKey
                ? getServiceTokenAgentKeyFromOption(options.githubAppPrivateKey)
                : null,
        ]);

    const awsSigner = new AwsRequestSigner();

    const baseProcessContext = createServerProcessContext({
        tracer,
        shutdownManager,
        awsSigner,
        options,
    });

    const opensearchContextModule = createServiceOpensearchContextModule(awsSigner, options);

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
                  securityGroupId: assertExists(
                      options.taskRealtimeServiceSecurityGroupId,
                      "`taskRealtimeServiceSecurityGroupId` option is required in production",
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

    // In tests, don't send push notifications. Otherwise in development and
    // production set up a connection pool to APNs so we can send notifications.
    let apnsContextModule: ApnsContextModuleBase;
    if (process.env.NODE_ENV === "test") {
        apnsContextModule = new TestApnsContextModule();
    } else {
        const apnsConnectionPool = new ApnsConnectionPool(baseProcessContext, {
            certificate: apnsCertificate,
            certificatePrivateKey: apnsCertificatePrivateKey,
        });

        shutdownManager.registerListener(
            "Destroying APNs connection pool",
            async (signal, span) => {
                await apnsConnectionPool.destroy(span);
            },
        );

        apnsContextModule = new ApnsContextModule(apnsConnectionPool);
    }

    const githubContextModule =
        process.env.NODE_ENV !== "production"
            ? new UnimplementedGithubContextModule()
            : (() => {
                  const auth = createGithubAppAuth({
                      appId: assertExists(options.githubAppId, "Missing `githubAppId` option"),
                      privateKey: assertExists(
                          githubAppPrivateKey,
                          "Missing `githubAppPrivateKey` option",
                      ),
                      clientId: assertExists(
                          options.githubAppClientId,
                          "Missing `githubAppClientId` option",
                      ),
                      clientSecret: assertExists(
                          options.githubAppClientSecret,
                          "Missing `githubAppClientSecret` option",
                      ),
                      installationId: assertExists(
                          options.githubAppInstallationId,
                          "Missing `githubAppInstallationId` option",
                      ),
                  });

                  return new GithubContextModule(auth.hook.bind(auth));
              })();

    // TODO(calebmer): Scheduler context module implementation in development when
    // we need it in development.
    const schedulerContextModule =
        process.env.NODE_ENV !== "production"
            ? new UnimplementedSchedulerContextModule()
            : new SchedulerContextModule({
                  region: "us-east-1",
                  jobQueueArn: assertExists(options.jobQueueArn, "Missing `jobQueueArn` option"),
                  jobQueueRoleArn: assertExists(
                      options.schedulerJobQueueRoleArn,
                      "Missing `schedulerJobQueueRoleArn` option",
                  ),
              });

    const processContext: JobQueueServiceProcessContext = baseProcessContext.clone({
        edge: new EdgeServiceContextModule({
            edgeServiceUrl: assertExists(
                options.edgeServiceUrl,
                "`edgeServiceUrl` option is required",
            ),
            tokenAgent,
        }),
        opensearch: opensearchContextModule,
        languageModel: new LanguageModelContextModule(languageModel),
        apns: apnsContextModule,
        github: githubContextModule,
        scheduler: schedulerContextModule,
        files: new FilesContextModule(tokenAgent),
        r2: createServiceCloudflareR2ContextModule(options),
    });

    const consumer = JobQueueConsumer.start(processContext, {
        region: "us-east-1",
        queueName: "Default",
        queueUrl: jobQueueUrl,

        // We'll run at most 100 jobs at once per Node.js worker.
        maxFiberCount: 10,
        maxFiberMessageCount: 10,

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
                action: (context: JobQueueServiceSystemActionContext) => Promise<Value>,
            ): Promise<Value> => {
                return processContext.with<
                    Omit<
                        JobQueueServiceSystemActionContextModules,
                        Exclude<keyof JobQueueServiceProcessContextModules, "tracer">
                    >,
                    Value
                >(
                    {
                        tracer: new TracerContextModule(context.tracer.getTracer()),
                        cache: context.cache.forkForChangedActor(),
                        batch: new BatchContextModule(),
                        actor: DynamoSystemActorContextModule.dangerouslyNew(
                            context.actor.serviceName,
                            spaceId,
                        ),
                        content: new ContentContextModule(),
                        tasks: new TaskContextModule({
                            tokenAgent,
                            router: taskRealtimeServiceRouter,
                            dangerouslyEscalateToSystemContext,
                        }),
                    },
                    action,
                );
            };

            const actionContext = _actionContext.clone<
                Omit<
                    JobQueueServiceSystemActionContextModules,
                    | keyof ServerSystemActionContextModules
                    | keyof JobQueueServiceProcessContextModules
                >
            >({
                content: new ContentContextModule(),
                tasks: new TaskContextModule({
                    tokenAgent,
                    router: taskRealtimeServiceRouter,
                    dangerouslyEscalateToSystemContext,
                }),
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
                action: (context: JobQueueServiceSystemActionContext) => Promise<Value>,
            ): Promise<Value> => {
                return processContext.with<
                    Omit<
                        JobQueueServiceSystemActionContextModules,
                        Exclude<keyof JobQueueServiceProcessContextModules, "tracer">
                    >,
                    Value
                >(
                    {
                        tracer: new TracerContextModule(context.tracer.getTracer()),
                        cache: context.cache.forkForChangedActor(),
                        batch: new BatchContextModule(),
                        actor: DynamoSystemActorContextModule.dangerouslyNew(
                            // Maintenance jobs don't have an actor. Escalating to a system context isn't
                            // actually dangerous, it's a de-escalation of permission. Say our actor's
                            // source is the job queue service.
                            "JobQueueService",
                            spaceId,
                        ),
                        content: new ContentContextModule(),
                        tasks: new TaskContextModule({
                            tokenAgent,
                            router: taskRealtimeServiceRouter,
                            dangerouslyEscalateToSystemContext,
                        }),
                    },
                    action,
                );
            };

            const actionContext = _actionContext.clone<
                Omit<
                    MaintenanceJobQueueServiceSystemActionContextModules,
                    | keyof ServerSystemActionContextModules
                    | keyof JobQueueServiceProcessContextModules
                >
            >({
                content: new ContentContextModule(),
                tasks: new TaskContextModule({
                    tokenAgent,
                    router: taskRealtimeServiceRouter,
                    dangerouslyEscalateToSystemContext,
                }),
            });

            return processMaintenanceJob(actionContext, job, jobStartTime, span);
        },
    });

    shutdownManager.registerListenerForIngressTraffic("Stopping job queue consumer", async () => {
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
}
