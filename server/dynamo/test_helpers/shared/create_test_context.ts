import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import path from "path";
import {DynamoLocal, startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local";
import {Session, SessionItem} from "~/server/dynamo/accounts_table";
import {
    AuthenticatedAuthContextModule,
    UnauthenticatedAuthContextModule,
} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext, ProcessContextModules} from "~/server/dynamo/context/process_context";
import {
    RequestContext,
    UnauthenticatedRequestContext,
} from "~/server/dynamo/context/request_context";
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
import {TracerRoot} from "~/shared/tracer/tracer_root";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export type TestContext = ProcessContext & {
    getDynamoLocalPort(): number;
    unauthenticatedRequest(): UnauthenticatedRequestContext;
    request(session: {item: SessionItem}): RequestContext;
};

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `ProcessContext` and you can easily
 * create `RequestContext`s.
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

    const dynamoContextModule = DynamoContextModule.test();

    const _context = Context.new<ProcessContextModules>({
        process: ProcessContextModule.test(),
        tracer: new TracerContextModule(tracer),
        dynamo: dynamoContextModule,
        email: new NoopEmailContextModule(),
    });

    let dynamoLocal: DynamoLocal | null = null;

    const getDynamoLocalPort = () => {
        if (dynamoLocal === null) throw new InternalError("DynamoDB local has not started");
        return dynamoLocal.port;
    };

    const createUnauthenticatedRequestContext = (): UnauthenticatedRequestContext => {
        return context.clone({
            cache: new CacheContextModule(),
            auth: new UnauthenticatedAuthContextModule(async () => null),
        });
    };

    const createRequestContext = (session: {item: SessionItem}): RequestContext => {
        return context.clone({
            cache: new CacheContextModule(),
            auth: new AuthenticatedAuthContextModule(Session.test(session.item)),
        });
    };

    const context = Object.assign(_context, {
        getDynamoLocalPort,
        unauthenticatedRequest: createUnauthenticatedRequestContext,
        request: createRequestContext,
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
