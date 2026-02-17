import {S3Client} from "@aws-sdk/client-s3";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {createAppAuth as createGithubAppAuth} from "@octokit/auth-app";
import fs from "fs-extra";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {ApnsContextModule} from "~/server/apns/apns_context_module.js";
import {BotWebhookContextModule} from "~/server/bots/bot_webhook_context_module.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {
    ApnsContextModuleBase,
    TestApnsContextModule,
} from "~/server/context/apns_context_module_base.js";
import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    NotificationsInjectionContextModule,
    SearchInjectionContextModule,
    SpacesInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {WebPushContextModule} from "~/server/context/web_push_context_module.js";
import {
    GithubContextModule,
    UnimplementedGithubContextModule,
} from "~/server/deploy/data/github_context_module.js";
import {
    SchedulerContextModule,
    UnimplementedSchedulerContextModule,
} from "~/server/deploy/data/scheduler_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {TraceOnlyEmailContextModule} from "~/server/emails/trace_only_email_context_module.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {
    ActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {ImporterContextModule} from "~/server/importer/importer_context_module.js";
import {ImporterDevelopmentContextModule} from "~/server/importer/importer_development_context_module.js";
import {JobQueueConsumer} from "~/server/jobs/queue/consumer/job_queue_consumer.js";
import {
    JobQueueServiceProcessContext,
    JobQueueServiceProcessContextModules,
    JobQueueServiceSystemActionContext,
    JobQueueServiceSystemActionContextModules,
} from "~/server/jobs/queue/job_queue_service_context.js";
import {processJob} from "~/server/jobs/queue/process_job.js";
import {processMaintenanceJob} from "~/server/jobs/queue/process_maintenance_job.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {
    createServerBasicProcessContextModules,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
    serviceTokenAgentOptions,
} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {
    createServiceOpensearchContextModule,
    serviceOpensearchOptions,
} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {
    createServiceTaskRealtimeServiceRouter,
    serviceTaskRealtimeServiceRouterOptions,
} from "~/server/tasks/data/create_service_task_realtime_service_router.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TokenAgentJobQueueServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    allMiniLmL6V2LanguageModel: {type: "string"},
    cohereApiKey: {type: "string"},
    apnsCertificate: {type: "string"},
    apnsCertificatePrivateKey: {type: "string"},
    webPushVapidPublicKey: {type: "string"},
    webPushVapidPrivateKey: {type: "string"},
    jobQueueArn: {type: "string"},
    schedulerJobQueueRoleArn: {type: "string"},
    githubAppId: {type: "string"},
    githubAppPrivateKey: {type: "string"},
    githubAppClientId: {type: "string"},
    githubAppClientSecret: {type: "string"},
    githubAppInstallationId: {type: "string"},
    importUploadsBucketName: {type: "string"},
    ...serviceTokenAgentOptions,
    ...serverBasicProcessContextOptions,
    ...serviceOpensearchOptions,
    ...serviceCloudflareR2Options,
    ...serviceTaskRealtimeServiceRouterOptions,
} as const;

export async function run({
    options,
    tracer,
    startupSpan,
    shutdownManager,
}: {
    options: Options;
    tracer: TracerRoot;
    startupSpan: TracerSpan;
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

    const [
        tokenAgent,
        apnsCertificate,
        apnsCertificatePrivateKey,
        webPushVapidPublicKey,
        webPushVapidPrivateKey,
        githubAppPrivateKey,
    ] = await runAllPromises([
        createServiceTokenAgent({
            serviceName: "JobQueueService",
            privateSide: TokenAgentJobQueueServicePrivateSide,
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
        getServiceTokenAgentKeyFromOption(
            assertExists(options.webPushVapidPublicKey, "Missing `webPushVapidPublicKey` option"),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(options.webPushVapidPrivateKey, "Missing `webPushVapidPrivateKey` option"),
        ),
        options.githubAppPrivateKey
            ? getServiceTokenAgentKeyFromOption(options.githubAppPrivateKey)
            : null,
    ]);

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const basicProcessContext = Context.new(
        createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
    );

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

    // In tests, don't send push notifications. Otherwise in development and
    // production set up a connection pool to APNs so we can send notifications.
    let apnsContextModule: ApnsContextModuleBase;
    if (isTestNodeEnvOrAdminScenariosScript) {
        apnsContextModule = new TestApnsContextModule();
    } else {
        const apnsConnectionPool = new ApnsConnectionPool(basicProcessContext, {
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

    const webPushContextModule = new WebPushContextModule({
        vapidPublicKey: webPushVapidPublicKey,
        vapidPrivateKey: webPushVapidPrivateKey,
    });

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
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
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
                batch: context.batch.forkForChangedActor(),
                actor: SystemActorContextModule.dangerouslyNew(
                    // `context.actor` is `undefined` for maintenance jobs.
                    context.actor?.serviceName ?? "JobQueueService",
                    spaceId,
                ),
            },
            action,
        );
    };

    const edgeServiceUrl = assertExists(
        options.edgeServiceUrl,
        "`edgeServiceUrl` option is required",
    );

    const resourceServiceUrl = assertExists(
        options.resourceServiceUrl,
        "`resourceServiceUrl` option is required",
    );

    const processContext: JobQueueServiceProcessContext = basicProcessContext.clone({
        opensearch: createServiceOpensearchContextModule(awsSigner, options),
        r2: createServiceCloudflareR2ContextModule(options),
        files: new FilesContextModule({tokenAgent, resourceServiceUrl}),
        edge: new EdgeServiceContextModule({tokenAgent, edgeServiceUrl}),
        tasks: new TaskContextModule({
            tokenAgent,
            router: createServiceTaskRealtimeServiceRouter(options),
            dangerouslyEscalateToSystemContext,
        }),
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        notificationsInjection: new NotificationsInjectionContextModule(notificationsInjection),
        searchInjection: new SearchInjectionContextModule(searchInjection),
        spacesInjection: new SpacesInjectionContextModule(spacesInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),

        // `JobQueueService` specific stuff.
        languageModel: new LanguageModelContextModule(languageModel),
        apns: apnsContextModule,
        github: githubContextModule,
        scheduler: schedulerContextModule,
        email:
            process.env.NODE_ENV === "production"
                ? new SesEmailContextModule(tokenAgent)
                : new TraceOnlyEmailContextModule(),
        botWebhook: new BotWebhookContextModule(tokenAgent),
        webPush: webPushContextModule,
        importer:
            process.env.NODE_ENV === "production"
                ? new ImporterContextModule({
                      s3Client: new S3Client({}),
                      bucketName: assertExists(
                          options.importUploadsBucketName,
                          "`importUploadsBucketName` option is required in production",
                      ),
                  })
                : new ImporterDevelopmentContextModule(),
    });

    const consumer = JobQueueConsumer.start(processContext, {
        region: "us-east-1",
        queueName: "Default",
        queueUrl: jobQueueUrl,

        // We'll run at most 100 jobs at once per Node.js worker.
        maxFiberCount: 10,
        maxFiberMessageCount: 10,

        processJob,
        processMaintenanceJob,
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
