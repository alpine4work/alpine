import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import path from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {Session, SessionItem} from "~/server/dynamo/accounts_table.js";
import {
    AppAmbiguousActionContext,
    AppSessionActionContext,
    AppSystemActionContext,
} from "~/server/dynamo/context/app_action_context.js";
import {
    AppUnknownActorContextModule,
    AppSessionActorContextModule,
    AppSystemActorContextModule,
    AppUnidentifiedActorContextModule,
} from "~/server/dynamo/context/app_actor_context_module.js";
import {
    AppProcessContext,
    AppProcessContextModulesBase,
} from "~/server/dynamo/context/app_process_context.js";
import {TestNotificationsContextModule} from "~/server/dynamo/context/notifications_context_module.js";
import {
    DynamoBatchContextModule,
    DynamoContextModule,
} from "~/server/dynamo/dynamo_context_module.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/shared/test_shared_hooks.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export type TestContext = AppProcessContext & {
    getDynamoLocalPort(): number;
    unauthenticatedAction(): AppAmbiguousActionContext;
    action(session: {item: SessionItem}): AppSessionActionContext;
    systemAction(spaceId: SpaceId): AppSystemActionContext;
};

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `AppProcessContext` and you can easily
 * create `AppActionContext`s.
 */
export function createTestContext(): TestContext {
    // Increase Jest timeout for tests using a test context since these tests
    // need to interact with the database which may be slow.
    //
    // The timeout shouldn't be too long since it will make it harder to debug
    // actual test failures due to timeout.
    if (import.meta.jest) import.meta.jest.setTimeout(1000 * 10);

    const tracer = TracerRoot.new({
        serviceName: "Test",
        jsHost: "Node",
        untrusted: false,
        getTime: () => Date.now(),
        sendEvent: () => {
            // We ignore all events generated in tests. Maybe we should write them to
            // a log file?
        },
    });

    let dynamoLocal: DynamoLocal | null = null;

    const getDynamoLocalPort = () => {
        if (dynamoLocal === null) throw new InternalError("DynamoDB local has not started");
        return dynamoLocal.port;
    };

    const createUnauthenticatedSessionContext = (): AppAmbiguousActionContext => {
        return processContextBase.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: new AppUnknownActorContextModule(async () => null),
        });
    };

    const createSessionContext = (session: {item: SessionItem}): AppSessionActionContext => {
        return processContextBase.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: new AppSessionActorContextModule(Session.test(session.item)),
        });
    };

    const createSystemContext = (spaceId: SpaceId): AppSystemActionContext => {
        return processContextBase.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: AppSystemActorContextModule.dangerouslyNew(spaceId),
        });
    };

    const dynamoContextModule = DynamoContextModule.test();

    const processContextBase = Context.new<AppProcessContextModulesBase>({
        process: ProcessContextModule.test(testSharedHooks),
        tracer: new TracerContextModule(tracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
        notifications: new TestNotificationsContextModule(createSystemContext),
    });

    const processContext: AppProcessContext = processContextBase.clone({
        actor: new AppUnidentifiedActorContextModule(),
    });

    const context = Object.assign(processContext, {
        getDynamoLocalPort,
        unauthenticatedAction: createUnauthenticatedSessionContext,
        action: createSessionContext,
        systemAction: createSystemContext,
    });

    testSharedHooks.beforeAll(async () => {
        const dataPath = await fs.mkdtemp(
            path.join(assertExists(process.env.TEST_TMPDIR), "dynamo_local_data_"),
        );

        const port = await getPort();
        dynamoLocal = await startDynamoLocal({dataPath, port});

        const awsClient = new AwsClient({
            accessKeyId: "local",
            secretAccessKey: "local",
        });

        dynamoContextModule.initialize(awsClient, `http://localhost:${port}`);
    });

    testSharedHooks.afterAll(async () => {
        await dynamoLocal?.stop();
    });

    return context;
}
