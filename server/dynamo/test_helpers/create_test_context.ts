import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {
    OpensearchLocal,
    startOpensearchLocal,
} from "~/admin/opensearch/local/start_opensearch_local.js";
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
    ServerUnknownActionContextModules,
} from "~/server/context/server_action_context.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {
    DynamoBatchContextModule,
    DynamoContextModule,
} from "~/server/dynamo/core/dynamo_context_module.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {NoopNotificationsContextModule} from "~/server/notifications/core/noop_notifications_context_module.js";
import {NotificationsContextModuleBase} from "~/server/notifications/core/notifications_context_module_base.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {
    OpensearchContextModule,
    TestDisabledOpensearchClient,
} from "~/server/opensearch/opensearch_context_module.js";
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

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export type TestContext = ServerProcessContext & {
    getDynamoLocalPort(): number;
    getOpensearchLocalPort(): number;
    isOpensearchEnabled: boolean;

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
    ): Context<
        ServerSessionActionContextModules & {
            fork: ForkActionContextModule;
            notifications: NotificationsContextModuleBase;
        }
    >;

    /**
     * An authenticated system action.
     */
    systemAction(spaceId: SpaceId): ServerSystemActionContext;

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
        action: (
            context: Context<
                ServerSystemActionContextModules & {
                    notifications: NotificationsContextModuleBase;
                }
            >,
        ) => Promise<Value>,
    ) => Promise<Value>;
};

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `AppProcessContext` and you can easily
 * create `AppActionContext`s.
 */
export function createTestContext({
    shouldStartOpensearch = false,
    createNotificationsContextModule = () => new NoopNotificationsContextModule(),
}: {
    shouldStartOpensearch?: boolean;
    createNotificationsContextModule?: () => NotificationsContextModuleBase;
} = {}): TestContext {
    // Increase Jest timeout for tests using a test context since these tests
    // need to interact with the database which may be slow.
    //
    // The timeout shouldn't be too long since it will make it harder to debug
    // actual test failures due to timeout.
    if (import.meta.jest) import.meta.jest.setTimeout(1000 * 10);

    let dynamoLocal: DynamoLocal | null = null;
    let opensearchLocal: OpensearchLocal | null = null;

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

    const escalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (
            context: Context<
                ServerSystemActionContextModules & {
                    notifications: NotificationsContextModuleBase;
                }
            >,
        ) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                ServerSystemActionContextModules,
                Exclude<keyof ServerProcessContextModules, "tracer">
            > & {
                notifications: NotificationsContextModuleBase;
            },
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.dangerouslyForkWithSharedCaches(),
                dynamoBatchContext: new DynamoBatchContextModule(),
                notifications: createNotificationsContextModule(),
                actor: DynamoSystemActorContextModule.dangerouslyNew(
                    context.actor.serviceName,
                    spaceId,
                ),
            },
            action,
        );
    };

    const createUnauthenticatedSessionContext = (): Context<
        ServerUnknownActionContextModules & {
            notifications: NotificationsContextModuleBase;
        }
    > => {
        return processContext.clone({
            dynamoBatchContext: new DynamoBatchContextModule(),
            cache: new CacheContextModule(),
            actor: new DynamoUnknownActorContextModule(async () => null),
            notifications: createNotificationsContextModule(),
        });
    };

    const createSessionContext = (
        session:
            | {id: SessionId; account: {id: AccountId}; createdTime: Date}
            | {sessionId: SessionId; accountId: AccountId; createdTime: Date},
    ): Context<
        ServerSessionActionContextModules & {
            fork: ForkActionContextModule;
            notifications: NotificationsContextModuleBase;
        }
    > => {
        return processContext.clone({
            dynamoBatchContext: new DynamoBatchContextModule(),
            cache: new CacheContextModule(),
            actor: DynamoSessionActorContextModule.dangerouslyNew("Test", Session.test(session)),
            notifications: createNotificationsContextModule(),
            fork: new ForkActionContextModule(),
        });
    };

    const createSystemContext = (
        spaceId: SpaceId,
    ): Context<
        ServerSystemActionContextModules & {
            notifications: NotificationsContextModuleBase;
        }
    > => {
        return processContext.clone({
            dynamoBatchContext: new DynamoBatchContextModule(),
            cache: new CacheContextModule(),
            actor: DynamoSystemActorContextModule.dangerouslyNew("Test", spaceId),
            notifications: createNotificationsContextModule(),
        });
    };

    const dynamoContextModule = DynamoContextModule.test();
    const opensearchContextModule = OpensearchContextModule.test();

    const processContext = Context.new<ServerProcessContextModules>({
        process: ProcessContextModule.test(testSharedHooks),
        tracer: new TracerContextModule(testTracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
        opensearch: opensearchContextModule,
    });

    const context = Object.assign(processContext, {
        getDynamoLocalPort,
        getOpensearchLocalPort,
        isOpensearchEnabled: shouldStartOpensearch,
        unauthenticatedAction: createUnauthenticatedSessionContext,
        action: createSessionContext,
        systemAction: createSystemContext,
        escalateToSystemContext,
    });

    testSharedHooks.beforeAll(async () => {
        const [tempPath, dynamoLocalPort, opensearchLocalPort] = await runAllPromises([
            fs.mkdtemp(joinPath(assertExists(process.env.TEST_TMPDIR), "cyberworlds_test_")),
            getPort(),
            getPort(),
        ]);

        [dynamoLocal, opensearchLocal] = await runAllPromises([
            startDynamoLocal({
                dataPath: joinPath(tempPath, "dynamo/data"),
                logsPath: joinPath(tempPath, "dynamo/logs"),
                port: dynamoLocalPort,
            }),
            shouldStartOpensearch
                ? startOpensearchLocal({
                      dataPath: joinPath(tempPath, "opensearch/data"),
                      logsPath: joinPath(tempPath, "opensearch/logs"),
                      port: opensearchLocalPort,
                  })
                : null,
        ]);

        const awsClient = new AwsClient({
            accessKeyId: "local",
            secretAccessKey: "local",
        });

        dynamoContextModule.initialize(awsClient, `http://localhost:${dynamoLocalPort}`);

        if (!opensearchLocal) {
            opensearchContextModule.initialize(new TestDisabledOpensearchClient());
        } else {
            opensearchContextModule.initialize(
                new OpensearchClient({
                    protocol: "http",
                    hostname: "localhost",
                    port: opensearchLocal.port,
                }),
            );
        }

        // Higher timeout for this hook as we start our services.
    }, 1000 * 30);

    testSharedHooks.afterAll(async () => {
        await runAllPromises([dynamoLocal?.stop(), opensearchLocal?.stop()]);
    });

    return context;
}
