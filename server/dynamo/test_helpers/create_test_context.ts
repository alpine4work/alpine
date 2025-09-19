import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {
    OpensearchLocal,
    startOpensearchLocal,
} from "~/admin/opensearch/local/start_opensearch_local.js";
import {SqsLocal, startSqsLocal} from "~/admin/sqs/local/start_sqs_local.js";
import {Session} from "~/server/accounts/accounts_actions.js";
import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {TestEmptyCloudflareR2Client} from "~/server/cloudflare/r2/test_empty_cloudflare_r2_client.js";
import {
    DynamoAnonymousActorContextModule,
    DynamoBotActorContextModule,
    DynamoImpersonatedAccountActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/context/dynamo_actor_context_module.js";
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
    SpacesInjection,
    SpacesInjectionContextModule,
    TasksInjection,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {
    ServerAccountActionContextModules,
    ServerAnonymousActionContextModules,
    ServerBotActionContextModules,
    ServerImpersonatedAccountActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
    ServerUnknownActionContextModules,
} from "~/server/context/server_action_context.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {TestTaskContextModule} from "~/server/context/task_context_module_base.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {TestLocalJobSender} from "~/server/dynamo/test_helpers/test_local_job_sender.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {ActorContextModule, ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    OpensearchClient,
    TestDisabledOpensearchClient,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {
    ServerConstantsContextModule,
    ServerConstantsContextModuleOptions,
} from "~/shared/context/constants_context_module.js";
import {Context, ContextWithDestroy} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

const env = parseDotenv();

// Assign AWS env variables to `process.env` so
// `@aws-sdk/credential-provider-node` picks them up.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;

type TestContextExtraModules = {
    email: EmailContextModuleBase;
};

export type TestContextModules = ServerProcessContextModules & TestContextExtraModules;

export type TestContext = Context<TestContextModules> & TestContextHelpers<TestContextModules>;

export type TestSessionActionContextModules = ServerSessionActionContextModules &
    TestContextExtraModules & {
        fork: ForkActionContextModule;
    };

export type TestSessionActionContext = Context<TestSessionActionContextModules>;

export type TestSystemActionContextModules = ServerSystemActionContextModules &
    TestContextExtraModules;

export type TestSystemActionContext = Context<TestSystemActionContextModules>;

export type TestAnonymousActionContextModules = ServerAnonymousActionContextModules &
    TestContextExtraModules;

export type TestAnonymousActionContext = Context<TestAnonymousActionContextModules>;

export type TestImpersonatedAccountActionContextModules =
    ServerImpersonatedAccountActionContextModules & TestContextExtraModules;

export type TestImpersonatedAccountActionContext =
    Context<TestImpersonatedAccountActionContextModules>;

export type TestBotActionContextModules = ServerBotActionContextModules & TestContextExtraModules;

export type TestBotActionContext = Context<TestBotActionContextModules>;

export type TestAccountActionContext = Context<TestAccountActionContextModules>;

export type TestAccountActionContextModules = ServerAccountActionContextModules &
    TestContextExtraModules;

export type TestUnknownActionContextModules = ServerUnknownActionContextModules &
    TestContextExtraModules;

export type TestUnknownActionContext = Context<TestUnknownActionContextModules>;

type TestContextWithDestroy<Modules extends {[key: string]: ContextModuleBase}> =
    ContextWithDestroy<Modules> & TestContextHelpers<Modules>;

type TestContextHelpers<Modules extends {[key: string]: ContextModuleBase}> = {
    getTemporaryDirectoryPath(): string;
    getDynamoLocalPort(): number;
    getOpensearchLocalPort(): number;
    readonly isOpensearchEnabled: boolean;
    getSqsLocalPort(): number;
    getSqsLocalJobQueueUrl(): string;
    getSqsLocalFileProcessorJobQueueUrl(): string;
    getSqsLocalFileProcessorLightJobQueueUrl(): string;
    getSqsLocalFileProcessorHeavyJobQueueUrl(): string;
    restartSqsLocal(): Promise<void>;

    /**
     * An action with an authenticated session.
     */
    action(
        session:
            | {id: SessionId; account: {id: AccountId}}
            | {sessionId: SessionId; accountId: AccountId},
        options?: {serviceName?: ActorServiceName},
    ): TestSessionActionContext;

    /**
     * An authenticated system action.
     */
    systemAction(
        spaceId: SpaceId,
        options?: {serviceName?: ActorServiceName},
    ): TestSystemActionContext;

    /**
     * An anonymous action.
     */
    anonymousAction(options?: {serviceName?: ActorServiceName}): TestAnonymousActionContext;

    /**
     * An authenticated impersonated account action.
     */
    impersonatedAccountAction(
        spaceId: SpaceId,
        accountId: AccountId,
        options?: {serviceName?: ActorServiceName},
    ): TestImpersonatedAccountActionContext;

    /**
     * An action for a bot in some specified scope.
     *
     * This function assumes you've already validated that `botAccountId` is
     * actually an `AccountId` for a bot account.
     */
    botAction(
        spaceId: SpaceId,
        botAccountId: AccountId,
        scope?: BotTokenPayloadScope,
        options?: {serviceName?: ActorServiceName},
    ): TestBotActionContext;

    /**
     * An action where we don't know whether we're authenticated or not. When
     * authenticated it'll be an anonymous actor.
     */
    unknownAnonymousAction(): TestUnknownActionContext;

    /**
     * Add a `CacheContextModule` to our test context. Each time you call
     * `withCache()` we create a new cache for the returned context object.
     */
    withCache(): Context<
        TestContextModules & {
            cache: CacheContextModule;
            batch: BatchContextModule;
        }
    >;

    /**
     * Escalate one of our existing test contexts to a system context.
     */
    readonly escalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: TestSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;

    /**
     * `Context.clone()` but preserves `TestContext`'s helper functions like
     * `context.action()` on the cloned context.
     */
    cloneWithHelpers<NewModules extends {[key: string]: ContextModuleBase}>(
        newModules: NewModules,
    ): TestContextWithDestroy<Replace<Modules, NewModules>>;

    /**
     * Set the job processing function for this context. Throws an error if the
     * job processing function has already been set.
     */
    setProcessJob(
        processJob: (
            context: Context<TestSystemActionContextModules & {apns: ApnsContextModuleBase}>,
            job: JobDescription,
            jobStartTime: Date,
            span: TracerSpan,
        ) => Promise<void>,
    ): void;
};

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `AppProcessContext` and you can easily
 * create `AppActionContext`s.
 *
 * - By default, we don't start OpenSearch for this test context since it's
 *   slow to start. Set `shouldStartOpensearch: true` if you need to write
 *   tests against OpenSearch.
 *
 * - By default, ignore jobs in the local test process. Provide `processJob` to
 *   process a job in the local text context. Provide `shouldSendJobsToSqs` to
 *   add your jobs to a local SQS server so a `JobConsumer` can process them
 *   instead of processing them locally.
 */
export function createTestContext(
    options: {
        shouldStartOpensearch?: boolean;
        chatInjection?: Partial<ChatInjection>;
        documentsInjection?: Partial<DocumentsInjection>;
        forumInjection?: Partial<ForumInjection>;
        notificationsInjection?: Partial<NotificationsInjection>;
        searchInjection?: Partial<SearchInjection>;
        spacesInjection?: Partial<SpacesInjection>;
        tasksInjection?: Partial<TasksInjection>;
    } & (
        | {
              shouldSendJobsToSqs: true;
              processJob?: undefined;
          }
        | {
              shouldSendJobsToSqs?: false;
              processJob?: (
                  context: Context<TestSystemActionContextModules & {apns: ApnsContextModuleBase}>,
                  job: JobDescription,
                  jobStartTime: Date,
                  span: TracerSpan,
              ) => Promise<void>;
          }
    ) = {},
): TestContext {
    const {shouldStartOpensearch = false, shouldSendJobsToSqs = false} = options;
    let {processJob} = options;

    // Increase Jest timeout for tests using a test context since these tests
    // need to interact with the database which may be slow.
    //
    // The timeout shouldn't be too long since it will make it harder to debug
    // actual test failures due to timeout.
    if (import.meta.jest) {
        // HACK: If the test file raises the timeout by calling
        // `import.meta.jest.setTimeout()` to something larger than 10s we don't want
        // to lower that test file specific timeout back down to 10s (e.g.
        // `feed_table.test.ts`).
        //
        // Looking at the Jest source code `import.meta.jest.setTimeout()` [writes to
        // a symbol on the global object][1] and later that [symbol is read to
        // determine the test's timeout][2].
        //
        // We hook into this mechanism to read the current test timeout and use it if
        // it's greater than 10s to make sure we're not lowering the timeout.
        //
        // [1]: https://github.com/jestjs/jest/blob/edee3ab3a8290b220970e2f32212b6a91d6ca8cd/packages/jest-runtime/src/index.ts#L2308-L2311
        // [2]: https://github.com/jestjs/jest/blob/edee3ab3a8290b220970e2f32212b6a91d6ca8cd/packages/jest-circus/src/eventHandler.ts#L229-L233
        const testTimeoutSymbol = Symbol.for("TEST_TIMEOUT_SYMBOL");

        const oldTestTimeout: unknown = (globalThis as any)[testTimeoutSymbol];
        assert(typeof oldTestTimeout === "number" || oldTestTimeout === undefined);

        // If a test file called `import.meta.jest.setTimeout()` before
        // `createTestContext()` (e.g. `feed_table.test.ts`) and the timeout is greater
        // than 10s, then use the previous timeout from the first
        // `import.meta.jest.setTimeout()` call.
        const minTestTimeout = 1000 * 10;
        const newTestTimeout =
            oldTestTimeout !== undefined && oldTestTimeout > minTestTimeout
                ? oldTestTimeout
                : minTestTimeout;

        import.meta.jest.setTimeout(newTestTimeout);

        // Double check that our hack works and that `import.meta.jest.setTimeout()`
        // actually updates the global `testTimeoutSymbol` property.
        assert((globalThis as any)[testTimeoutSymbol] === newTestTimeout);
    }

    const environmentConstants: ServerConstantsContextModuleOptions = {
        edgeServiceUrl: env.EDGE_SERVICE_URL ?? "https://test.cyberworlds.dev",
    };
    const constantsContextModule = new ServerConstantsContextModule(environmentConstants);

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
            statsPort: null,
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
                actor: DynamoSystemActorContextModule.dangerouslyNew(
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
            actor: new DynamoUnknownActorContextModule(async () =>
                DynamoAnonymousActorContextModule.dangerouslyNew("Test"),
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
            actor: DynamoSessionActorContextModule.dangerouslyNew(
                serviceName,
                Session.test(session),
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
            actor: DynamoSystemActorContextModule.dangerouslyNew(serviceName, spaceId),
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
            actor: DynamoAnonymousActorContextModule.dangerouslyNew(serviceName),
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
            actor: DynamoImpersonatedAccountActorContextModule.dangerouslyNew(
                DynamoSystemActorContextModule.dangerouslyNew(serviceName, spaceId),
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
            serviceName = "Test",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): TestBotActionContext => {
        return processContext.clone({
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: DynamoBotActorContextModule.dangerouslyNew(
                serviceName,
                spaceId,
                botAccountId,
                scope,
            ),
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

    let searchInjection = options.searchInjection;
    let tasksInjection = options.tasksInjection;

    // Automatically inject a noop for `dangerouslyFavoriteSearchEntityWithoutAuthorization`.
    // That way adding a space account (common in tests) doesn't fail when we haven't
    // injected this rather ugly function name.
    searchInjection = {
        dangerouslyFavoriteSearchEntityWithoutAuthorization: asyncNoop,
        ...searchInjection,
    };

    // If OpenSearch is disabled we don't need to index task actions. Noop instead
    // of throw.
    if (!shouldStartOpensearch) {
        tasksInjection = {
            indexTaskActionTransactionAssumingItsCommitted: asyncNoop,
            ...tasksInjection,
        };
    }

    const processContext = Context.new<TestContextModules>({
        process: ProcessContextModule.test(testSharedHooks),
        tracer: new TracerContextModule(testTracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
        opensearch: opensearchContextModule,
        jobs: jobsContextModule,
        constants: constantsContextModule,
        edge: new TestLocalEdgeServiceContextModule(),
        files: new TestFilesContextModule(),
        r2: new CloudflareR2ContextModule(new TestEmptyCloudflareR2Client()),
        chatInjection: ChatInjectionContextModule.test(options.chatInjection),
        documentsInjection: DocumentsInjectionContextModule.test(options.documentsInjection),
        forumInjection: ForumInjectionContextModule.test(options.forumInjection),
        notificationsInjection: NotificationsInjectionContextModule.test(
            options.notificationsInjection,
        ),
        searchInjection: SearchInjectionContextModule.test(searchInjection),
        spacesInjection: SpacesInjectionContextModule.test(options.spacesInjection),
        tasksInjection: TasksInjectionContextModule.test(tasksInjection),
        tasks: new TestTaskContextModule({
            dangerouslyEscalateToSystemContext: escalateToSystemContext,
        }),
    });

    const helpers: TestContextHelpers<any> = {
        getTemporaryDirectoryPath,
        getDynamoLocalPort,
        getOpensearchLocalPort,
        isOpensearchEnabled: shouldStartOpensearch,
        getSqsLocalPort,
        getSqsLocalJobQueueUrl,
        getSqsLocalFileProcessorJobQueueUrl,
        getSqsLocalFileProcessorLightJobQueueUrl,
        getSqsLocalFileProcessorHeavyJobQueueUrl,
        restartSqsLocal,
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
    };

    const context = Object.assign(processContext, helpers);

    const beforeAllTimeoutMs = 1000 * 30;

    testSharedHooks.beforeAll(async () => {
        // Anything in this directory will be available in an `output.zip` file in the
        // `bazel-testlogs` directory. Put our service logs in this directory.
        const testUndeclaredOutputsPath = assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR);
        const testTmpdirPath = assertExists(process.env.TEST_TMPDIR);

        if (!(await fs.pathExists(testTmpdirPath))) {
            await fs.mkdirs(testTmpdirPath);
        }

        const [newTemporaryDirectoryPath, dynamoLocalPort, opensearchLocalPort, sqsLocalPort] =
            await runAllPromises([
                fs.mkdtemp(joinPath(testTmpdirPath, "cyberworlds_test_")),
                getPort(),
                shouldStartOpensearch ? getPort() : null,
                shouldSendJobsToSqs ? getPort() : null,
            ]);

        temporaryDirectoryPath = newTemporaryDirectoryPath;

        const ensureLocalCachePath = joinPath(temporaryDirectoryPath, "ensure");

        [dynamoLocal, opensearchLocal, sqsLocal] = await runAllPromises([
            startDynamoLocal({
                withInMemoryData: true,
                logsPath: joinPath(testUndeclaredOutputsPath, "dynamo"),
                port: dynamoLocalPort,
            }),
            shouldStartOpensearch
                ? startOpensearchLocal({
                      configPath: joinPath(temporaryDirectoryPath, "opensearch/config"),
                      dataPath: joinPath(temporaryDirectoryPath, "opensearch/data"),
                      logsPath: joinPath(testUndeclaredOutputsPath, "opensearch"),
                      port: assertExists(opensearchLocalPort),
                  })
                : null,
            shouldSendJobsToSqs
                ? startSqsLocal({
                      withInMemoryData: true,
                      logsPath: joinPath(testUndeclaredOutputsPath, "sqs"),
                      port: assertExists(sqsLocalPort),
                      statsPort: null,
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
            jobsContextModule.initialize(
                new TestLocalJobSender({
                    processJob: async (context, job, jobStartTime, span) => {
                        await processJob?.(context, job, jobStartTime, span);
                    },
                    createSystemContext,
                    getProcessContext,
                }),
            );
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

    testSharedHooks.afterAll(async () => {
        await runAllPromises([
            dynamoLocal?.stop(),
            sqsLocal?.stop({force: true}),
            opensearchLocal?.stop(),
        ]);
    });

    return context;
}
