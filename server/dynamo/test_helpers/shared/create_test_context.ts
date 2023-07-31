import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {
    WorkerSessionActionContext,
    WorkerSystemActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {Session, SessionItem} from "~/server/dynamo/accounts_table.js";
import {
    AppSessionActionContext,
    AppSessionActionContextModules,
    AppSystemActionContext,
    AppSystemActionContextModules,
    AppUnknownActionContext,
} from "~/server/dynamo/context/app_action_context.js";
import {
    AppSessionActorContextModule,
    AppSystemActorContextModule,
    AppUnknownActorContextModule,
} from "~/server/dynamo/context/app_actor_context_module.js";
import {
    AppProcessContext,
    AppProcessContextModules,
} from "~/server/dynamo/context/app_process_context.js";
import {TestNotificationsContextModule} from "~/server/dynamo/context/notifications_context_module.js";
import {
    DynamoBatchContextModule,
    DynamoContextModule,
} from "~/server/dynamo/dynamo_context_module.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/shared/test_shared_hooks.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {writeTracerEventToFileInDev} from "~/server/tracer/write_tracer_event_to_file_in_dev.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export type TestSessionActionContext = Context<TestSessionActionContextModules>;

export type TestSessionActionContextModules = MergeObjectIntersection<
    AppSessionActionContextModules & {
        rpc: LocalRpcContextModule;
    }
>;

export type TestSystemActionContext = Context<TestSystemActionContextModules>;

export type TestSystemActionContextModules = MergeObjectIntersection<
    AppSystemActionContextModules & {
        rpc: LocalRpcContextModule;
    }
>;

export type TestContext = AppProcessContext & {
    getDynamoLocalPort(): number;
    unauthenticatedAction(): AppUnknownActionContext;
    action(session: {item: SessionItem}): TestSessionActionContext;
    systemAction(spaceId: SpaceId): TestSystemActionContext;
};

// Should be able to use a `TestSessionActionContext` for code expecting an app
// action context or a worker action context.
assertAssignableTypes<TestSessionActionContext, AppSessionActionContext>();
assertAssignableTypes<TestSessionActionContext, WorkerSessionActionContext>();

// Should be able to use a `TestSystemActionContextModules` for code expecting an app
// action context or a worker action context.
assertAssignableTypes<TestSystemActionContext, AppSystemActionContext>();
assertAssignableTypes<TestSystemActionContext, WorkerSystemActionContext>();

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `AppProcessContext` and you can easily
 * create `AppActionContext`s.
 */
export function createTestContext(): TestContext {
    const tracer = TracerRoot.new({
        serviceName: "Test",
        jsHost: "Node",
        untrusted: false,
        getTime: () => Date.now(),
        // Don't send events from tests to Honeycomb. That feels like too much. But do
        // write events to our dev files. This can help developers debug.
        sendEvent: writeTracerEventToFileInDev,
    });

    let dynamoLocal: DynamoLocal | null = null;

    const getDynamoLocalPort = () => {
        if (dynamoLocal === null) throw new InternalError("DynamoDB local has not started");
        return dynamoLocal.port;
    };

    const createUnauthenticatedSessionContext = (): AppUnknownActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: new AppUnknownActorContextModule(async () => null),
            notifications: new TestNotificationsContextModule(createSystemContext),
        });
    };

    const createSessionContext = (session: {item: SessionItem}): TestSessionActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: AppSessionActorContextModule.dangerouslyNew("Test", Session.test(session.item)),
            rpc: new LocalRpcContextModule(),
            notifications: new TestNotificationsContextModule(createSystemContext),
        });
    };

    const createSystemContext = (spaceId: SpaceId): TestSystemActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
            actor: AppSystemActorContextModule.dangerouslyNew("Test", spaceId),
            rpc: new LocalRpcContextModule(),
            notifications: new TestNotificationsContextModule(createSystemContext),
        });
    };

    const dynamoContextModule = DynamoContextModule.test();

    const processContext = Context.new<AppProcessContextModules>({
        process: ProcessContextModule.test(testSharedHooks),
        tracer: new TracerContextModule(tracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
    });

    const context = Object.assign(processContext, {
        getDynamoLocalPort,
        unauthenticatedAction: createUnauthenticatedSessionContext,
        action: createSessionContext,
        systemAction: createSystemContext,
    });

    testSharedHooks.beforeAll(async () => {
        const tempPath = await fs.mkdtemp(
            joinPath(assertExists(process.env.TEST_TMPDIR), "dynamo_local_"),
        );

        const port = await getPort();

        dynamoLocal = await startDynamoLocal({
            dataPath: joinPath(tempPath, "data"),
            logsPath: joinPath(tempPath, "logs"),
            port,
        });

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
