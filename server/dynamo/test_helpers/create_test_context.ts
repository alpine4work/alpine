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
import {Session} from "~/server/accounts/accounts_table.js";
import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {
    ServerSessionActionContextModules,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
    ServerUnknownActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {
    DynamoBatchContextModule,
    DynamoContextModule,
} from "~/server/dynamo/core/dynamo_context_module.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {TestLocalJobSender} from "~/server/dynamo/test_helpers/test_local_job_sender.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    OpensearchClient,
    TestDisabledOpensearchClient,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context, ContextWithDestroy} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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

export type TestContext = Context<ServerProcessContextModules> &
    TestContextHelpers<ServerProcessContextModules>;

type TestContextWithDestroy<Modules extends {[key: string]: ContextModuleBase}> =
    ContextWithDestroy<Modules> & TestContextHelpers<Modules>;

type TestContextHelpers<Modules extends {[key: string]: ContextModuleBase}> = {
    getTempPath(): string;
    getDynamoLocalPort(): number;
    getOpensearchLocalPort(): number;
    readonly isOpensearchEnabled: boolean;
    getSqsLocalPort(): number;
    getSqsLocalJobQueueUrl(): string;
    restartSqsLocal(): Promise<void>;

    /**
     * An action where we don't know whether we're authenticated or not.
     */
    unauthenticatedAction(): ServerUnknownActionContext;

    /**
     * An action with an authenticated session.
     */
    action(
        session:
            | {id: SessionId; account: {id: AccountId}; createdTime: Date}
            | {sessionId: SessionId; accountId: AccountId; createdTime: Date},
        options?: {serviceName: ActorServiceName},
    ): Context<
        ServerSessionActionContextModules & {
            fork: ForkActionContextModule;
        }
    >;

    /**
     * An authenticated system action.
     */
    systemAction(
        spaceId: SpaceId,
        options?: {serviceName: ActorServiceName},
    ): ServerSystemActionContext;

    /**
     * Add a `CacheContextModule` to our test context. Each time you call
     * `withCache()` we create a new cache for the returned context object.
     */
    withCache(): Context<
        ServerProcessContextModules & {
            cache: CacheContextModule;
            dynamoBatchContext: DynamoBatchContextModule;
        }
    >;

    /**
     * Escalate one of our existing test contexts to a system context.
     */
    readonly escalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;

    /**
     * `Context.clone()` but preserves `TestContext`'s helper functions like
     * `context.action()` on the cloned context.
     */
    cloneWithHelpers<NewModules extends {[key: string]: ContextModuleBase}>(
        newModules: NewModules,
    ): TestContextWithDestroy<Replace<Modules, NewModules>>;
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
export function createTestContext({
    shouldStartOpensearch = false,
    shouldSendJobsToSqs = false,
    processJob = async () => {},
}: {
    shouldStartOpensearch?: boolean;
} & (
    | {
          shouldSendJobsToSqs: true;
          processJob?: undefined;
      }
    | {
          shouldSendJobsToSqs?: false;
          processJob?: (
              context: Context<ServerSystemActionContextModules & {apns: ApnsContextModuleBase}>,
              job: JobDescription,
              jobStartTime: Date,
              span: TracerSpan,
          ) => Promise<void>;
      }
) = {}): TestContext {
    // Increase Jest timeout for tests using a test context since these tests
    // need to interact with the database which may be slow.
    //
    // The timeout shouldn't be too long since it will make it harder to debug
    // actual test failures due to timeout.
    if (import.meta.jest) import.meta.jest.setTimeout(1000 * 10);

    let tempPath: string | null = null;
    let dynamoLocal: DynamoLocal | null = null;
    let opensearchLocal: OpensearchLocal | null = null;
    let sqsLocal: SqsLocal | null = null;

    const getTempPath = () => {
        if (tempPath === null) throw new InternalError("Temporary directory has not been created");
        return tempPath;
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
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                ServerSystemActionContextModules,
                Exclude<keyof ServerProcessContextModules, "tracer">
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.dangerouslyForkWithSharedCaches(),
                dynamoBatchContext: new DynamoBatchContextModule(),
                actor: DynamoSystemActorContextModule.dangerouslyNew(
                    context.actor.serviceName,
                    spaceId,
                ),
            },
            action,
        );
    };

    const createUnauthenticatedSessionContext = (): ServerUnknownActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: new DynamoUnknownActorContextModule(async () => null),
        });
    };

    const createSessionContext = (
        session:
            | {id: SessionId; account: {id: AccountId}; createdTime: Date}
            | {sessionId: SessionId; accountId: AccountId; createdTime: Date},
        {
            // Dangerously allow pretending to be from any context in tests.
            serviceName = "Test",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): Context<
        ServerSessionActionContextModules & {
            fork: ForkActionContextModule;
        }
    > => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
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
            // Dangerously allow pretending to be from any context in tests.
            serviceName = "Test",
        }: {
            serviceName?: ActorServiceName;
        } = {},
    ): ServerSystemActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: DynamoSystemActorContextModule.dangerouslyNew(serviceName, spaceId),
        });
    };

    const withCache = () => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
        });
    };

    const dynamoContextModule = DynamoContextModule.test();
    const opensearchContextModule = OpensearchContextModule.test();
    const jobsContextModule = JobsContextModule.test();

    const processContext = Context.new<ServerProcessContextModules>({
        process: ProcessContextModule.test(testSharedHooks),
        tracer: new TracerContextModule(testTracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
        opensearch: opensearchContextModule,
        jobs: jobsContextModule,
        edge: new TestLocalEdgeServiceContextModule(),
    });

    const helpers: TestContextHelpers<any> = {
        getTempPath,
        getDynamoLocalPort,
        getOpensearchLocalPort,
        isOpensearchEnabled: shouldStartOpensearch,
        getSqsLocalPort,
        getSqsLocalJobQueueUrl,
        restartSqsLocal,
        unauthenticatedAction: createUnauthenticatedSessionContext,
        action: createSessionContext,
        systemAction: createSystemContext,
        withCache,
        escalateToSystemContext,
        cloneWithHelpers(modules) {
            return Object.assign((this as any).clone(modules), helpers);
        },
    };

    const context = Object.assign(processContext, helpers);

    const beforeAllTimeoutMs = 1000 * 30;

    testSharedHooks.beforeAll(async () => {
        // Anything in this directory will be available in an `output.zip` file in the
        // `bazel-testlogs` directory. Put our service logs in this directory.
        const testUndeclaredOutputsPath = assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR);

        const [newTempPath, dynamoLocalPort, opensearchLocalPort, sqsLocalPort] =
            await runAllPromises([
                fs.mkdtemp(joinPath(assertExists(process.env.TEST_TMPDIR), "cyberworlds_test_")),
                getPort(),
                shouldStartOpensearch ? getPort() : null,
                shouldSendJobsToSqs ? getPort() : null,
            ]);
        tempPath = newTempPath;

        [dynamoLocal, opensearchLocal, sqsLocal] = await runAllPromises([
            startDynamoLocal({
                withInMemoryData: true,
                logsPath: joinPath(testUndeclaredOutputsPath, "dynamo"),
                port: dynamoLocalPort,
            }),
            shouldStartOpensearch
                ? startOpensearchLocal({
                      configPath: joinPath(tempPath, "opensearch/config"),
                      dataPath: joinPath(tempPath, "opensearch/data"),
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

        dynamoContextModule.initialize(`http://localhost:${dynamoLocalPort}`, awsSigner);

        if (!opensearchLocal) {
            opensearchContextModule.initialize(new TestDisabledOpensearchClient());
        } else {
            opensearchContextModule.initialize(
                new OpensearchClient(`http://localhost:${opensearchLocal.port}`, awsSigner),
            );
        }

        if (!sqsLocal) {
            jobsContextModule.initialize(
                new TestLocalJobSender({
                    processJob,
                    createSystemContext,
                }),
            );
        } else {
            jobsContextModule.initialize(
                new JobSender({
                    region: "us-east-1",
                    queueUrl: `http://localhost:${sqsLocal.port}/local/JobQueue`,
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
