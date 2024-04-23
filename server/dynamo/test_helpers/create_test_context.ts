import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
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
import {
    ServerSessionActionContextModules,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
    ServerUnknownActionContext,
} from "~/server/context/server_action_context.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
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
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export type TestContext = ServerProcessContext & {
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
              context: ServerSystemActionContext,
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

    let dynamoLocal: DynamoLocal | null = null;
    let opensearchLocal: OpensearchLocal | null = null;
    let sqsLocal: SqsLocal | null = null;

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

        sqsLocal = await startSqsLocal({
            dataPath: currentSqsLocal.dataPath,
            logsPath: currentSqsLocal.logsPath,
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

    const context = Object.assign(processContext, {
        getDynamoLocalPort,
        getOpensearchLocalPort,
        isOpensearchEnabled: shouldStartOpensearch,
        getSqsLocalPort,
        getSqsLocalJobQueueUrl,
        restartSqsLocal,
        unauthenticatedAction: createUnauthenticatedSessionContext,
        action: createSessionContext,
        systemAction: createSystemContext,
        escalateToSystemContext,
    });

    testSharedHooks.beforeAll(async () => {
        const [tempPath, dynamoLocalPort, opensearchLocalPort, sqsLocalPort] = await runAllPromises(
            [
                fs.mkdtemp(joinPath(assertExists(process.env.TEST_TMPDIR), "cyberworlds_test_")),
                getPort(),
                shouldStartOpensearch ? getPort() : null,
                shouldSendJobsToSqs ? getPort() : null,
            ],
        );

        [dynamoLocal, opensearchLocal, sqsLocal] = await runAllPromises([
            startDynamoLocal({
                dataPath: joinPath(tempPath, "dynamo/data"),
                logsPath: joinPath(tempPath, "dynamo/logs"),
                port: dynamoLocalPort,
            }),
            shouldStartOpensearch
                ? startOpensearchLocal({
                      dataPath: joinPath(tempPath, "opensearch/data"),
                      logsPath: joinPath(tempPath, "opensearch/logs"),
                      port: assertExists(opensearchLocalPort),
                  })
                : null,
            shouldSendJobsToSqs
                ? startSqsLocal({
                      dataPath: joinPath(tempPath, "sqs/data"),
                      logsPath: joinPath(tempPath, "sqs/logs"),
                      port: assertExists(sqsLocalPort),
                      statsPort: null,
                  })
                : null,
        ]);

        const awsSigner = new AwsRequestSigner({
            accessKeyId: "local",
            secretAccessKey: "local",
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

        // Higher timeout for this hook as we start our services.
    }, 1000 * 30);

    testSharedHooks.afterAll(async () => {
        await runAllPromises([
            dynamoLocal?.stop(),
            sqsLocal?.stop({force: true}),
            opensearchLocal?.stop(),
        ]);
    });

    return context;
}
