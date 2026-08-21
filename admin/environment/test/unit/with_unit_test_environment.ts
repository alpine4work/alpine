/* eslint-disable testing-library/no-debugging-utils */

import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {TestLocalEdgeServiceContextModule} from "~/admin/environment/test/unit/test_local_edge_service_context_module.js";
import {TestLocalJobSender} from "~/admin/environment/test/unit/test_local_job_sender.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {
    OpensearchLocal,
    startOpensearchLocal,
} from "~/admin/opensearch/local/start_opensearch_local.js";
import {SqsLocal, startSqsLocal} from "~/admin/sqs/local/start_sqs_local.js";
import {BillingNoopDevelopmentContextModule} from "~/server/billing/billing_noop_development_context_module.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {TestEmptyCloudflareR2Client} from "~/server/cloudflare/r2/test_empty_cloudflare_r2_client.js";
import {TestFilesContextModule} from "~/server/context/files_context_module.js";
import {
    ChatInjection,
    ChatInjectionContextModule,
    DocumentsInjection,
    DocumentsInjectionContextModule,
    ForumInjection,
    ForumInjectionContextModule,
    NotificationsInjection,
    NotificationsInjectionContextModule,
    SearchInjection,
    SearchInjectionContextModule,
    SitesInjection,
    SitesInjectionContextModule,
    SpacesInjection,
    SpacesInjectionContextModule,
    TasksInjection,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {PushContextModules} from "~/server/context/push_context_modules.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {TestTaskContextModule} from "~/server/context/task_context_module_base.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {incrementLocalDynamoTableSchemaGenerationForTest} from "~/server/dynamo/core/dynamo_table_schema.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {TraceOnlyEmailContextModule} from "~/server/emails/trace_only_email_context_module.js";
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
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {ImporterServiceDevelopmentContextModule} from "~/server/importer/importer_service/importer_service_development_context_module.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {NoopSlackContextModule} from "~/server/integrations/slack/noop_slack_context_module.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {LanguageModelsNoopDevelopmentContextModule} from "~/server/language_models/language_models_noop_development_context_module.js";
import {
    OpensearchClient,
    TestDisabledOpensearchClient,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {LogoDevNoopContextModule} from "~/server/spaces/logo_dev_context_module.js";
import {LoopsNoopContextModule} from "~/server/spaces/loops_context_module.js";
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
import {TaskRealtimeServiceRouterBase} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context, ContextWithDestroy} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.open_source.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {SessionId} from "~/shared/id/types/id_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

// This file should only run in a Node.js test environment. Either Jest or
// Playwright.
assert(process.release.name === "node");
assert(isTestNodeEnvOrAdminScenariosScript);

const debug = createDebug(import.meta.url);

const env = parseDotenv();

// Assign AWS env variables to `process.env` so `@aws-sdk/credential-provider-node`
// picks them up. Clear `AWS_PROFILE` and `AWS_SESSION_TOKEN` from the ambient
// shell (developers often have these set for real AWS work) since
// `defaultProvider()` prefers `AWS_PROFILE` over `AWS_ACCESS_KEY_ID`/
// `AWS_SECRET_ACCESS_KEY`.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_PROFILE;
delete process.env.AWS_SESSION_TOKEN;

export type TestActualContext = Context<TestContextModules> &
    TestActualContextHelpers<TestContextModules>;

assertAssignableTypes<TestActualContext, TestContext>();

type TestActualContextWithDestroy<Modules extends {[key: string]: ContextModuleBase}> =
    ContextWithDestroy<Modules> & TestActualContextHelpers<Modules>;

type TestActualContextHelpers<Modules extends {[key: string]: ContextModuleBase}> = Omit<
    TestContextHelpers<Modules>,
    "cloneWithHelpers"
> &
    TestActualContextAdditionalHelpers<Modules>;

type TestActualContextAdditionalHelpers<Modules extends {[key: string]: ContextModuleBase}> = {
    readonly isOpensearchEnabled: boolean;

    getTemporaryDirectoryPath(): string;
    getDynamoLocalPort(): number;
    getOpensearchLocalPort(): number;
    getSqsLocalPort(): number;
    getSqsLocalJobQueueUrl(): string;
    getSqsLocalFileProcessorJobQueueUrl(): string;
    getSqsLocalFileProcessorLightJobQueueUrl(): string;
    getSqsLocalFileProcessorHeavyJobQueueUrl(): string;
    waitForSqsProcessJobs(): Promise<void>;

    restartSqsLocal(): Promise<void>;
    resetDynamoLocal(): Promise<void>;

    /**
     * Add a `CacheContextModule` to our test context. Each time you call `withCache()`
     * we create a new cache for the returned context object.
     */
    withCache(): Context<
        TestContextModules & {
            cache: CacheContextModule;
            batch: BatchContextModule;
        }
    >;

    /**
     * `Context.clone()` but preserves `TestContext`'s helper functions like
     * `context.action()` on the cloned context.
     */
    cloneWithHelpers<NewModules extends {[key: string]: ContextModuleBase}>(
        newModules: NewModules,
    ): TestActualContextWithDestroy<Replace<Modules, NewModules>>;

    /**
     * Set the job processing function for this context. Throws an error if the job
     * processing function has already been set.
     */
    setProcessJob(
        processJob: (
            context: Context<TestSystemActionContextModules & PushContextModules>,
            job: JobDescription,
            jobStartTime: Date,
            span: TracerSpan,
        ) => Promise<void>,
    ): void;

    getDurableObjectBroadcasts(): ReadonlyArray<{
        readonly url: `/api/durable-objects/${string}`;
        readonly body: SchemaSerializedValue | null | undefined;
    }>;

    takeDurableObjectBroadcasts(): ReadonlyArray<{
        readonly url: `/api/durable-objects/${string}`;
        readonly body: SchemaSerializedValue | null | undefined;
    }>;
};

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `AppProcessContext` and you can easily create
 * `AppActionContext`s.
 *
 * - By default, we don't render emails for this test context since rendering
 *   happens asynchronously and may cause tests that use waitForTestTasks to hang.
 *   Set `shouldRenderEmails: true` if you need to render emails in your tests..
 *
 * - By default, we don't start OpenSearch for this test context since it's slow to
 *   start. Set `shouldStartOpensearch: true` if you need to write tests against
 *   OpenSearch.
 *
 * - By default, ignore jobs in the local test process. Provide `processJob` to
 *   process a job in the local text context. Provide `shouldSendJobsToSqs` to add
 *   your jobs to a local SQS server so a `JobConsumer` can process them instead of
 *   processing them locally.
 */
export async function withUnitTestEnvironment<Value>(
    options: Parameters<typeof actuallyCreateUnitTestEnvironment>[1],
    action: (context: TestActualContext) => Promise<Value>,
): Promise<Value> {
    const beforeEachCallbacks: Array<() => MaybePromise<void>> = [];
    const afterEachCallbacks: Array<() => MaybePromise<void>> = [];
    const beforeAllCallbacks: Array<() => MaybePromise<void>> = [];
    const afterAllCallbacks: Array<() => MaybePromise<void>> = [];

    const context = actuallyCreateUnitTestEnvironment(
        {
            beforeEach: callback => beforeEachCallbacks.push(callback),
            afterEach: callback => afterEachCallbacks.push(callback),
            beforeAll: callback => beforeAllCallbacks.push(callback),
            afterAll: callback => afterAllCallbacks.push(callback),
        },
        options,
    );

    for (const callback of beforeAllCallbacks) {
        await callback();
    }

    for (const callback of beforeEachCallbacks) {
        await callback();
    }

    try {
        const promiseWaiter = new PromiseWaiter();

        const actualContext = context.cloneWithHelpers({
            process: new ProcessContextModule({
                waitUntil: promise => {
                    promiseWaiter.waitUntil(promise);
                    context.process.waitUntil(promise);
                },
            }),
        });

        const value = await action(actualContext);

        // Wait for all `waitUntil()` promises to resolve before cleaning up the
        // environment.
        await promiseWaiter.wait();

        return value;
    } finally {
        for (const callback of afterEachCallbacks) {
            await callback();
        }

        for (const callback of afterAllCallbacks) {
            await callback();
        }
    }
}

/**
 * Creates a unit test environment and the associated `TestActualContext` object.
 * Designed to be used in Jest tests where setup/teardown is managed by
 * `beforeAll()` and `afterAll()` callbacks.
 *
 * When writing a unit test, prefer using `createTestContext()` which provides a
 * more convenient interface for establishing a unit test environment in Jest.
 *
 * If you need a unit test environment outside of Jest (e.g. in an adhoc script),
 * use `withUnitTestEnvironmentContext()` which automatically manages
 * setup/teardown of the environment for you.
 */
export function actuallyCreateUnitTestEnvironment(
    testHooks: {
        beforeEach: (action: () => MaybePromise<void>) => void;
        afterEach: (action: () => MaybePromise<void>) => void;
        beforeAll: (action: () => MaybePromise<void>, timeoutMs: number) => void;
        afterAll: (action: () => MaybePromise<void>) => void;
    },
    options: {
        undeclaredOutputsDirectoryPath: string;
        createTemporaryDirectoryPath: () => Promise<string>;
        shouldRenderEmails?: boolean;
        shouldStartOpensearch?: boolean;
        sendRequestToDurableObject?: (
            context: Context<{}>,
            request: {
                url: `/api/durable-objects/${string}`;
                serviceName: TokenServiceName;
                route: `/api/durable-objects/${string}`;
                body?: SchemaSerializedValue | null;
            },
        ) => Promise<any>;
        chatInjection?: Partial<ChatInjection>;
        documentsInjection?: Partial<DocumentsInjection>;
        forumInjection?: Partial<ForumInjection>;
        notificationsInjection?: Partial<NotificationsInjection>;
        searchInjection?: Partial<SearchInjection>;
        sitesInjection?: Partial<SitesInjection>;
        spacesInjection?: Partial<SpacesInjection>;
        tasksInjection?: Partial<TasksInjection>;
        taskContextModule?: {
            tokenAgent: MaybeThunk<TokenAgent>;
            router: TaskRealtimeServiceRouterBase;
        };
    } & (
        | {
              shouldSendJobsToSqs: true;
              processJob?: undefined;
              processMaintenanceJob?: undefined;
          }
        | {
              shouldSendJobsToSqs?: false;
              processJob?: (
                  context: Context<TestSystemActionContextModules & PushContextModules>,
                  job: JobDescription,
                  jobStartTime: Date,
                  span: TracerSpan,
              ) => Promise<void>;
              processMaintenanceJob?: (
                  context: ServerProcessContext,
                  job: MaintenanceJobDescription,
                  jobStartTime: Date,
                  span: TracerSpan,
              ) => Promise<void>;
          }
    ),
): TestActualContext {
    const {
        undeclaredOutputsDirectoryPath,
        createTemporaryDirectoryPath,
        shouldStartOpensearch = false,
        shouldSendJobsToSqs = false,
        processMaintenanceJob,
    } = options;

    let {processJob} = options;

    const constantsContextModule = new ConstantsContextModule({
        edgeServiceUrl: "https://test.cyberworlds.dev",
        resourceServiceUrl: "https://resources.test.cyberworlds.dev",
    });

    let temporaryDirectoryPath: string | null = null;
    let dynamoLocal: DynamoLocal | null = null;
    let opensearchLocal: OpensearchLocal | null = null;
    let sqsLocal: SqsLocal | null = null;

    const getTemporaryDirectoryPath = () => {
        if (temporaryDirectoryPath === null)
            throw new InternalError("Temporary directory has not been created");
        return temporaryDirectoryPath;
    };

    const getDynamoLocalPort = () => {
        if (dynamoLocal === null) throw new InternalError("DynamoDB local has not started");
        return dynamoLocal.port;
    };

    const getOpensearchLocalPort = () => {
        if (opensearchLocal === null) {
            if (shouldStartOpensearch) {
                throw new InternalError("OpenSearch local has not started");
            } else {
                throw new InternalError(
                    "OpenSearch local is not enabled for this test context, to start OpenSearch set `shouldStartOpensearch: true` in `createTestContext()`",
                );
            }
        }

        return opensearchLocal.port;
    };

    const getSqsLocalPort = () => {
        if (sqsLocal === null) {
            if (shouldSendJobsToSqs) {
                throw new InternalError("SQS local has not started");
            } else {
                throw new InternalError(
                    "SQS local is not enabled for this test context, to start SQS set `shouldSendJobsToSqs: true` in `createTestContext()`",
                );
            }
        }

        return sqsLocal.port;
    };

    const getSqsLocalJobQueueUrl = () => {
        return `http://localhost:${getSqsLocalPort()}/local/JobQueue`;
    };

    const getSqsLocalFileProcessorJobQueueUrl = () => {
        return `http://localhost:${getSqsLocalPort()}/local/FileProcessorJobQueue`;
    };

    const getSqsLocalFileProcessorLightJobQueueUrl = () => {
        return `http://localhost:${getSqsLocalPort()}/local/FileProcessorLightJobQueue`;
    };

    const getSqsLocalFileProcessorHeavyJobQueueUrl = () => {
        return `http://localhost:${getSqsLocalPort()}/local/FileProcessorHeavyJobQueue`;
    };

    const waitForSqsProcessJobs = () => {
        if (sqsLocal === null) {
            if (shouldSendJobsToSqs) {
                throw new InternalError("SQS local has not started");
            } else {
                throw new InternalError(
                    "SQS local is not enabled for this test context, to start SQS set `shouldSendJobsToSqs: true` in `createTestContext()`",
                );
            }
        }

        return sqsLocal.waitForProcessJobs();
    };

    const restartSqsLocal = async () => {
        assert(sqsLocal, "SQS local must have been started before");

        const currentSqsLocal = sqsLocal;
        sqsLocal = null;
        await currentSqsLocal.stop({force: true});

        const counterMatch = currentSqsLocal.logsPath.match(/-([0-9]+)$/);
        let counter = Math.max(2, parseInt(counterMatch?.[1] ?? "1", 10) + 1);
        while (await fs.pathExists(`${currentSqsLocal.logsPath}-${counter}`)) {
            counter++;
        }

        sqsLocal = await startSqsLocal({
            withInMemoryData: true,
            logsPath: `${
                counterMatch
                    ? currentSqsLocal.logsPath.slice(0, -counterMatch[0].length)
                    : currentSqsLocal.logsPath
            }-${counter}`,
            port: currentSqsLocal.port,
            statsPort: currentSqsLocal.statsPort,
        });
    };

    const resetDynamoLocal = async () => {
        assert(dynamoLocal, "DynamoDB local must have been started before");

        if (shouldStartOpensearch) {
            throw new InternalError(
                "Resetting DynamoDB in tests while OpenSearch is also running (`shouldStartOpensearch: true`) is dangerous " +
                    "because while DynamoDB\u2019s data is reset, data in OpenSearch remains which may cause unexpected issues.",
            );
        }

        if (shouldSendJobsToSqs) {
            throw new InternalError(
                "Resetting DynamoDB in tests while SQS is also running (`shouldSendJobsToSqs: true`) is dangerous " +
                    "because while DynamoDB\u2019s data is reset, messages in SQS remain which may cause unexpected issues.",
            );
        }

        const currentDynamoLocal = dynamoLocal;
        dynamoLocal = null;
        await currentDynamoLocal.stop();
        incrementLocalDynamoTableSchemaGenerationForTest();

        const counterMatch = currentDynamoLocal.logsPath.match(/-([0-9]+)$/);
        let counter = Math.max(2, parseInt(counterMatch?.[1] ?? "1", 10) + 1);
        while (await fs.pathExists(`${currentDynamoLocal.logsPath}-${counter}`)) {
            counter++;
        }

        dynamoLocal = await startDynamoLocal({
            withInMemoryData: true,
            port: currentDynamoLocal.port,
            logsPath: `${
                counterMatch
                    ? currentDynamoLocal.logsPath.slice(0, -counterMatch[0].length)
                    : currentDynamoLocal.logsPath
            }-${counter}`,
        });
    };

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
                    context.actor?.serviceName ?? "Test",
                    spaceId,
                ),
            },
            action,
        );
    };

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
            serviceName = "Test",
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
            serviceName = "Test",
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

    const getProcessContext = (): ServerProcessContext => {
        return processContext;
    };

    const createAnonymousContext = ({
        // Dangerously allow pretending to be from any service in tests.
        serviceName = "Test",
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
            serviceName = "Test",
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
        scope: BotTokenScope = {type: "Space"},
        {
            // Dangerously allow pretending to be from any service in tests.
            serviceName = "Test",
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

    const withCache = () => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
        });
    };

    const dynamoContextModule = DynamoContextModule.test();
    const opensearchContextModule = OpensearchContextModule.test();
    const jobsContextModule = JobsContextModule.test();

    let tasksInjection = options.tasksInjection;

    // If OpenSearch is disabled we don't need to index task actions. Noop instead of
    // throw.
    if (!shouldStartOpensearch) {
        tasksInjection = {
            indexTaskActionTransactionAssumingItsCommitted: asyncNoop,
            ...tasksInjection,
        };
    }

    const taskContextModule = options.taskContextModule
        ? new TaskContextModule({
              tokenAgent: options.taskContextModule.tokenAgent,
              router: options.taskContextModule.router,
              dangerouslyEscalateToSystemContext: escalateToSystemContext,
          })
        : new TestTaskContextModule({
              dangerouslyEscalateToSystemContext: escalateToSystemContext,
          });

    let durableObjectBroadcasts: Array<{
        readonly url: `/api/durable-objects/${string}`;
        readonly body: SchemaSerializedValue | null | undefined;
    }> = [];

    let durableObjectRequests: Array<{
        readonly url: `/api/durable-objects/${string}`;
        readonly body: SchemaSerializedValue | null | undefined;
    }> = [];

    testHooks.beforeEach(async () => {
        durableObjectBroadcasts = [];
        durableObjectRequests = [];
    });

    testHooks.afterEach(async () => {
        durableObjectBroadcasts = [];
        durableObjectRequests = [];
    });

    const processContext = Context.new<TestContextModules>({
        process: ProcessContextModule.test(testHooks),
        tracer: new TracerContextModule(testTracer),
        dynamo: dynamoContextModule,
        email: options.shouldRenderEmails
            ? new TraceOnlyEmailContextModule()
            : new NoopEmailContextModule(),
        opensearch: opensearchContextModule,
        jobs: jobsContextModule,
        constants: constantsContextModule,
        edge: new TestLocalEdgeServiceContextModule({
            broadcastToDurableObject: broadcast => durableObjectBroadcasts.push(broadcast),
            sendRequestToDurableObject: async (context, request) => {
                durableObjectRequests.push(request);
                return await options.sendRequestToDurableObject?.(context, request);
            },
        }),
        files: new TestFilesContextModule(),
        r2: new CloudflareR2ContextModule(new TestEmptyCloudflareR2Client()),
        languageModels: new LanguageModelsNoopDevelopmentContextModule(),
        logoDev: new LogoDevNoopContextModule(),
        loops: new LoopsNoopContextModule(),
        chatInjection: ChatInjectionContextModule.test(options.chatInjection),
        documentsInjection: DocumentsInjectionContextModule.test(options.documentsInjection),
        forumInjection: ForumInjectionContextModule.test(options.forumInjection),
        notificationsInjection: NotificationsInjectionContextModule.test(
            options.notificationsInjection,
        ),
        searchInjection: SearchInjectionContextModule.test(options.searchInjection),
        sitesInjection: SitesInjectionContextModule.test(options.sitesInjection),
        spacesInjection: SpacesInjectionContextModule.test(options.spacesInjection),
        tasksInjection: TasksInjectionContextModule.test(tasksInjection),
        tasks: taskContextModule,
        billing: new BillingNoopDevelopmentContextModule(),
        // Tests that just want to track calls to startValidateNotionImport and
        // startNotionImport use TestImporterContextModule without a callback. Only tests
        // that actually want to run import processing should pass a callback. See
        // TestImporterContextModule for details.
        importer: new TestImporterContextModule({
            getLocalUploadPath: getTemporaryDirectoryPath,
        }),
        // Importer service module for tests that need to read uploaded files. Uses
        // TEST_TMPDIR provided by Bazel for test isolation.
        importerService: new ImporterServiceDevelopmentContextModule({
            getLocalUploadPath: getTemporaryDirectoryPath,
        }),
        slack: new NoopSlackContextModule(),
    });

    const helpers: TestActualContextHelpers<TestContextModules> = {
        isOpensearchEnabled: shouldStartOpensearch,

        getTemporaryDirectoryPath,
        getDynamoLocalPort,
        getOpensearchLocalPort,
        getSqsLocalPort,
        getSqsLocalJobQueueUrl,
        getSqsLocalFileProcessorJobQueueUrl,
        getSqsLocalFileProcessorLightJobQueueUrl,
        getSqsLocalFileProcessorHeavyJobQueueUrl,
        waitForSqsProcessJobs,
        restartSqsLocal,
        resetDynamoLocal,
        action: createSessionContext,
        systemAction: createSystemContext,
        anonymousAction: createAnonymousContext,
        impersonatedAccountAction: createImpersonatedAccountContext,
        botAction: createBotContext,
        unknownAnonymousAction: createUnknownAnonymousContext,
        withCache,
        escalateToSystemContext,
        cloneWithHelpers(modules) {
            return Object.assign((this as any).clone(modules), helpers);
        },
        setProcessJob: newProcessJob => {
            assert(processJob === undefined);
            processJob = newProcessJob;
        },
        getDurableObjectBroadcasts: () => {
            return durableObjectBroadcasts;
        },
        takeDurableObjectBroadcasts: () => {
            const broadcasts = durableObjectBroadcasts;
            durableObjectBroadcasts = [];
            return broadcasts;
        },
    };

    const context = Object.assign(processContext, helpers);

    // Create `TestLocalJobSender` outside of `beforeAll` so its `afterEach` hook gets
    // registered synchronously before any tests run. Jest doesn't allow new hooks to
    // be registered after tests have started.
    const localJobSender = !shouldSendJobsToSqs
        ? new TestLocalJobSender({
              processJob: async (context, job, jobStartTime, span) => {
                  await processJob?.(context, job, jobStartTime, span);
              },
              processMaintenanceJob: async (context, job, jobStartTime, span) => {
                  await processMaintenanceJob?.(context, job, jobStartTime, span);
              },
              createSystemContext,
              getProcessContext,
              afterEach: testHooks.afterEach,
          })
        : null;

    const beforeAllTimeoutMs = 1000 * 30;

    testHooks.beforeAll(async () => {
        debug("Starting services");

        const [newTemporaryDirectoryPath, dynamoLocalPort, opensearchLocalPort, sqsLocalPorts] =
            await runAllPromises([
                createTemporaryDirectoryPath(),
                getPort(),
                shouldStartOpensearch ? getPort() : null,
                shouldSendJobsToSqs ? runAllPromises([getPort(), getPort()]) : null,
            ]);

        temporaryDirectoryPath = newTemporaryDirectoryPath;

        const ensureLocalCachePath = joinPath(temporaryDirectoryPath, "ensure");

        [dynamoLocal, opensearchLocal, sqsLocal] = await runAllPromises([
            startDynamoLocal({
                withInMemoryData: true,
                logsPath: joinPath(undeclaredOutputsDirectoryPath, "dynamo"),
                port: dynamoLocalPort,
            }).then(dynamoLocal => {
                debug("DynamoDB is ready");
                return dynamoLocal;
            }),
            shouldStartOpensearch
                ? startOpensearchLocal({
                      configPath: joinPath(temporaryDirectoryPath, "opensearch/config"),
                      dataPath: joinPath(temporaryDirectoryPath, "opensearch/data"),
                      logsPath: joinPath(undeclaredOutputsDirectoryPath, "opensearch"),
                      port: assertExists(opensearchLocalPort),
                  }).then(opensearchLocal => {
                      debug("OpenSearch is ready");
                      return opensearchLocal;
                  })
                : null,
            shouldSendJobsToSqs
                ? startSqsLocal({
                      withInMemoryData: true,
                      logsPath: joinPath(undeclaredOutputsDirectoryPath, "sqs"),
                      port: assertExists(sqsLocalPorts)[0],
                      statsPort: assertExists(sqsLocalPorts)[1],
                  }).then(sqsLocal => {
                      debug("SQS is ready");
                      return sqsLocal;
                  })
                : null,
        ]);

        const awsSigner = new AwsRequestSigner({
            accessKeyId: assertExists(process.env.AWS_ACCESS_KEY_ID),
            secretAccessKey: assertExists(process.env.AWS_SECRET_ACCESS_KEY),
        });

        dynamoContextModule.initialize({
            url: `http://localhost:${dynamoLocalPort}`,
            signer: awsSigner,
            ensureLocalCachePath: joinPath(ensureLocalCachePath, "dynamo"),
        });

        if (!opensearchLocal) {
            opensearchContextModule.initialize(new TestDisabledOpensearchClient());
        } else {
            opensearchContextModule.initialize(
                new OpensearchClient({
                    url: `http://localhost:${opensearchLocal.port}`,
                    signer: awsSigner,
                    ensureLocalCachePath: joinPath(ensureLocalCachePath, "opensearch"),
                }),
            );
        }

        if (!sqsLocal) {
            jobsContextModule.initialize(assertExists(localJobSender));
        } else {
            jobsContextModule.initialize(
                new JobSender({
                    region: "us-east-1",
                    queueUrl: `http://localhost:${sqsLocal.port}/local/JobQueue`,
                    fileProcessorQueueUrl: `http://localhost:${sqsLocal.port}/local/FileProcessorJobQueue`,
                    fileProcessorHeavyQueueUrl: `http://localhost:${sqsLocal.port}/local/FileProcessorHeavyJobQueue`,
                    fileProcessorLightQueueUrl: `http://localhost:${sqsLocal.port}/local/FileProcessorLightJobQueue`,
                }),
            );
        }
    }, beforeAllTimeoutMs);

    testHooks.afterAll(async () => {
        debug("Stopping services");

        await runAllPromises([
            dynamoLocal?.stop().then(() => {
                debug("DynamoDB was stopped");
            }),
            sqsLocal?.stop({force: true}).then(() => {
                debug("SQS was stopped");
            }),
            opensearchLocal?.stop().then(() => {
                debug("OpenSearch was stopped");
            }),
        ]);
    });

    return context;
}
