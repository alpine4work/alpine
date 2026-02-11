import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import {join as joinPath} from "path";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {BillingNoopDevelopmentContextModule} from "~/server/billing/billing_noop_development_context_module.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
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
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {TraceOnlyEmailContextModule} from "~/server/emails/trace_only_email_context_module.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {
    ActorContextModule,
    ActorServiceName,
    AnonymousActorContextModule,
    BotActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
    UnknownActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {
    avatarsBindingName,
    avatarsBucketName,
} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {ImporterDevelopmentContextModule} from "~/server/importer/importer_development_context_module.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {createServiceTokenAgent} from "~/server/node/create_service_token_agent.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {
    LogoDevContextModule,
    LogoDevNoopContextModule,
} from "~/server/spaces/logo_dev_context_module.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {
    TestAnonymousActionContext,
    TestBotActionContext,
    TestContext,
    TestContextHelpers,
    TestContextModules,
    TestImpersonatedAccountActionContext,
    TestSessionActionContext,
    TestSystemActionContext,
    TestSystemActionContextModules,
    TestUnknownActionContext,
} from "~/server/spaces/test_helpers/test_context.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/data/task_realtime_service_local_router.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {createServerTracerAndHoneycombClient} from "~/server/tracer/server_tracer.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

// This file should only run in a Node.js development environment.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "development");

// Double check this isn't a Jest test.
assert(!import.meta.jest);

const env = parseDotenv();

const ensureLocalCachePath = joinPath(devEnvPaths.cache, "ensure");
const keysDirectoryPath = joinPath(devEnvPaths.config, "keys");
const cloudflareR2LocalDataPath = joinPath(devEnvPaths.data, "r2");

const keyDirectoryPath = (name: string) => {
    return joinPath(keysDirectoryPath, name);
};

const assertPort = (portString: string | undefined) => {
    assert(portString);
    const port = parseInt(portString, 10);
    assert(!isNaN(port));
    return port;
};

const dynamoLocalPort = assertPort(env.DYNAMO_LOCAL_PORT);
const opensearchLocalPort = assertPort(env.OPENSEARCH_LOCAL_PORT);
const sqsLocalPort = assertPort(env.SQS_LOCAL_PORT);
const edgeDevPort = assertPort(env.EDGE_DEV_PORT);
const resourcesDevPort = assertPort(env.RESOURCES_DEV_PORT);
const fileProcessorDevPort = assertPort(env.FILE_PROCESSOR_DEV_PORT);
const taskRealtimeServiceLocalPort = assertPort(env.TASK_REALTIME_DEV_PORT);

/**
 * Create a context for our development environment. This depends on the
 * dev command running and our local services (e.g. DynamoDB, OpenSearch, etc.)
 * being available.
 *
 * The context type is `TestContext` which has just about everything you'd want
 * and lets you use our test helpers like `TestDocument` with the context.
 */
export async function withDevelopmentEnvironment<Value>(
    action: (
        context: TestContext,
        options: {tokenAgent: TokenAgent<TokenAgentAppServicePrivateSide>},
    ) => Promise<Value>,
): Promise<Value> {
    const promiseWaiter = new PromiseWaiter();

    const awsSigner = new AwsRequestSigner({
        accessKeyId: assertExists(env.AWS_ACCESS_KEY_ID),
        secretAccessKey: assertExists(env.AWS_SECRET_ACCESS_KEY),
    });

    const [tracer] = createServerTracerAndHoneycombClient({
        serviceName: "Admin",
        jsHost: "Node",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "tracer",
        waitUntil: promiseWaiter.waitUntil,
    });

    // Use `AppService` for signing tokens so we can sign session cookies.
    const tokenAgent = await createServiceTokenAgent({
        serviceName: "AppService",
        privateSide: TokenAgentAppServicePrivateSide,
        options: {
            appServicePublicKey: keyDirectoryPath("app_service_rsa.pub"),
            edgeServiceFamilyPublicKey: keyDirectoryPath("edge_service_family_rsa.pub"),
            taskRealtimeServicePublicKey: keyDirectoryPath("task_realtime_service_rsa.pub"),
            jobQueueServicePublicKey: keyDirectoryPath("job_queue_service_rsa.pub"),
            fileProcessorServicePublicKey: keyDirectoryPath("file_processor_service_rsa.pub"),
            apiServicePublicKey: keyDirectoryPath("api_service_rsa.pub"),
            resourceServicePublicKey: keyDirectoryPath("resource_service_rsa.pub"),
            servicePrivateKey: keyDirectoryPath("app_service_rsa"),
            tokenAgentSecret: keyDirectoryPath("token_agent_secret"),
        },
    });

    const cloudflareBuckets = [
        {bucketName: filesBucketName, bindingName: filesBindingName},
        {bucketName: avatarsBucketName, bindingName: avatarsBindingName},
    ];

    const cloudflareBucketByName = new Map(
        cloudflareBuckets.map(({bucketName, bindingName}) => {
            const r2Storage = new FileStorage(joinPath(cloudflareR2LocalDataPath, bindingName));
            const r2Bucket = new R2Bucket(r2Storage);
            return [bucketName, r2Bucket];
        }),
    );

    const cloudflareClient = new MiniflareR2Client({
        fileProcessorServiceUrl: `http://localhost:${fileProcessorDevPort}`,
        bucketByName: cloudflareBucketByName,
    });

    const escalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: TestSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<TestSystemActionContextModules, Exclude<keyof TestContextModules, "tracer">>,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.forkForChangedActor(),
                batch: context.batch.forkForChangedActor(),
                actor: SystemActorContextModule.dangerouslyNew(
                    context.actor?.serviceName ?? "Admin",
                    spaceId,
                ),
            },
            action,
        );
    };

    const processContext = Context.new<TestContextModules>({
        process: new ProcessContextModule({waitUntil: promiseWaiter.waitUntil}),
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            url: `http://localhost:${dynamoLocalPort}`,
            signer: awsSigner,
            ensureLocalCachePath,
        }),
        email: new TraceOnlyEmailContextModule(),
        opensearch: OpensearchContextModule.new(
            new OpensearchClient({
                url: `http://localhost:${opensearchLocalPort}`,
                signer: awsSigner,
                ensureLocalCachePath,
            }),
        ),
        jobs: JobsContextModule.new(
            new JobSender({
                region: "us-east-1",
                queueUrl: `http://localhost:${sqsLocalPort}/local/JobQueue`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                fileProcessorQueueUrl: `http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
                fileProcessorLightQueueUrl: `http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
                fileProcessorHeavyQueueUrl: `http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
            }),
        ),
        constants: new ConstantsContextModule({
            edgeServiceUrl: `http://localhost:${edgeDevPort}`,
            resourceServiceUrl: `http://localhost:${resourcesDevPort}`,
        }),
        edge: new EdgeServiceContextModule({
            tokenAgent,
            edgeServiceUrl: `http://localhost:${edgeDevPort}`,
        }),
        files: new FilesContextModule({
            tokenAgent,
            resourceServiceUrl: `http://localhost:${resourcesDevPort}`,
        }),
        billing: new BillingNoopDevelopmentContextModule(),
        importer: new ImporterDevelopmentContextModule(),
        r2: new CloudflareR2ContextModule(cloudflareClient),
        logoDev:
            env.LOGO_DEV_SECRET_KEY && env.LOGO_DEV_PUBLISHABLE_KEY
                ? new LogoDevContextModule({
                      secretKey: env.LOGO_DEV_SECRET_KEY,
                      publishableKey: env.LOGO_DEV_PUBLISHABLE_KEY,
                  })
                : new LogoDevNoopContextModule(),
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        notificationsInjection: new NotificationsInjectionContextModule(notificationsInjection),
        searchInjection: new SearchInjectionContextModule(searchInjection),
        spacesInjection: new SpacesInjectionContextModule(spacesInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
        tasks: new TaskContextModule({
            router: new TaskRealtimeServiceLocalRouter({port: taskRealtimeServiceLocalPort}),
            tokenAgent,
            dangerouslyEscalateToSystemContext: escalateToSystemContext,
        }),
    });

    const createUnknownAnonymousContext = (): TestUnknownActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: new UnknownActorContextModule(async () =>
                AnonymousActorContextModule.dangerouslyNew("Test"),
            ),
        });
    };

    const createSessionContext = (
        session:
            | {id: SessionId; account: {id: AccountId}}
            | {sessionId: SessionId; accountId: AccountId},
        {
            // Dangerously allow pretending to be from any service in tests.
            serviceName = "Admin",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): TestSessionActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
                serviceName,
                "id" in session ? session.id : session.sessionId,
                "id" in session ? session.account.id : session.accountId,
            ),
            fork: new ForkActionContextModule(),
        });
    };

    const createSystemContext = (
        spaceId: SpaceId,
        {
            // Dangerously allow pretending to be from any service in tests.
            serviceName = "Admin",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): TestSystemActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: SystemActorContextModule.dangerouslyNew(serviceName, spaceId),
        });
    };

    const createAnonymousContext = ({
        // Dangerously allow pretending to be from any service in tests.
        serviceName = "Admin",
    }: {
        serviceName?: ActorServiceName;
    } = {}): TestAnonymousActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: AnonymousActorContextModule.dangerouslyNew(serviceName),
        });
    };

    const createImpersonatedAccountContext = (
        spaceId: SpaceId,
        accountId: AccountId,
        {
            // Dangerously allow pretending to be from any service in tests.
            serviceName = "Admin",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): TestImpersonatedAccountActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: ImpersonatedAccountActorContextModule.dangerouslyNew(
                SystemActorContextModule.dangerouslyNew(serviceName, spaceId),
                accountId,
            ),
        });
    };

    const createBotContext = (
        spaceId: SpaceId,
        botAccountId: AccountId,
        scope: BotTokenPayloadScope = {type: "Space"},
        {
            // Dangerously allow pretending to be from any service in tests.
            serviceName = "Admin",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): TestBotActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: BotActorContextModule.dangerouslyNew(serviceName, spaceId, botAccountId, scope),
            fork: new ForkActionContextModule(),
        });
    };

    const helpers: TestContextHelpers<TestContextModules> = {
        action: createSessionContext,
        systemAction: createSystemContext,
        anonymousAction: createAnonymousContext,
        impersonatedAccountAction: createImpersonatedAccountContext,
        botAction: createBotContext,
        unknownAnonymousAction: createUnknownAnonymousContext,
        escalateToSystemContext,
        cloneWithHelpers(modules) {
            return Object.assign((this as any).clone(modules), helpers);
        },
    };

    const context: TestContext = Object.assign(processContext, helpers);

    const valueResult = await captureResultPromise(() => action(context, {tokenAgent}));

    try {
        // Wait for all `waitUntil()` promises to resolve before destroying the context
        // and returning (even if there was an error).
        await promiseWaiter.wait();
    } catch (error) {
        // If `promiseWaiter` threw AND `action()` threw then create an aggregate error
        // with both error messages.
        if (!valueResult.ok) {
            throw createAggregateError([valueResult.error, error]);
        } else {
            throw error;
        }
    } finally {
        // We're done processing `action()`, destroy our context.
        processContext.destroy();
    }

    return unwrapResult(valueResult);
}
