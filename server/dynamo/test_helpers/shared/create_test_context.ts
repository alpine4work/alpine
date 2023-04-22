import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import path from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local";
import {Session, SessionItem} from "~/server/dynamo/accounts_table";
import {
    MaybeSessionActionContext,
    SessionActionContext,
    SystemActionContext,
} from "~/server/dynamo/context/action_context";
import {
    MaybeSessionActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
    UnidentifiedActorContextModule,
} from "~/server/dynamo/context/actor_context_module";
import {TestNotificationsContextModule} from "~/server/dynamo/context/notifications_context_module";
import {ProcessContext, ProcessContextModulesBase} from "~/server/dynamo/context/process_context";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {testSharedHooks} from "~/server/dynamo/test_helpers/shared/test_shared_hooks";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {SpaceId} from "~/shared/id/types/id_types";
import {TracerRoot} from "~/shared/tracer/tracer_root";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export type TestContext = ProcessContext & {
    getDynamoLocalPort(): number;
    unauthenticatedAction(): MaybeSessionActionContext;
    action(session: {item: SessionItem}): SessionActionContext;
    systemAction(spaceId: SpaceId): SystemActionContext;
};

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `ProcessContext` and you can easily
 * create `ActionContext`s.
 */
export function createTestContext(): TestContext {
    // Increase Jest timeout for tests using a test context since these tests
    // need to interact with the database which may be slow.
    //
    // The timeout shouldn't be too long since it will make it harder to debug
    // actual test failures due to timeout.
    if (typeof jest !== "undefined") jest.setTimeout(1000 * 10);

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

    const createUnauthenticatedSessionContext = (): MaybeSessionActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            actor: new MaybeSessionActorContextModule(async () => null),
        });
    };

    const createSessionContext = (session: {item: SessionItem}): SessionActionContext => {
        return processContext.clone({
            cache: new CacheContextModule(),
            actor: new SessionActorContextModule(Session.test(session.item)),
        });
    };

    const createSystemContext = (spaceId: SpaceId): SystemActionContext => {
        return processContextBase.clone({
            cache: new CacheContextModule(),
            actor: new SystemActorContextModule(spaceId),
        });
    };

    const dynamoContextModule = DynamoContextModule.test();

    const processContextBase = Context.new<ProcessContextModulesBase>({
        process: ProcessContextModule.test(),
        tracer: new TracerContextModule(tracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
        notifications: new TestNotificationsContextModule(createSystemContext),
    });

    const processContext: ProcessContext = processContextBase.clone({
        actor: new UnidentifiedActorContextModule(),
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
