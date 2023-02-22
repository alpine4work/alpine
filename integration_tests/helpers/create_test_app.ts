import getPort from "get-port";
import {LocalApp, createLocalApp} from "~/app/local/create_local_app";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";

export type TestApp = {
    readonly url: string;
};

/**
 * Run our app server in tests.
 */
export function createTestApp(
    context: TestContext,
    {globals}: {globals?: {[key: string]: unknown}},
): TestApp {
    let localAppAndPort: {localApp: LocalApp; port: number} | null = null;

    beforeAll(async () => {
        const localApp = createLocalApp({
            bindings: {
                NODE_ENV: "test",
                LOCAL_DYNAMO_PORT: context.getLocalDynamoPort(),
            },
            globals,
        });

        const port = await getPort();

        await new Promise<void>(resolve => {
            localApp.server.listen(port, () => resolve());
        });

        localAppAndPort = {localApp, port};
    });

    afterAll(async () => {
        assert(localAppAndPort !== null);
        localAppAndPort.localApp.server.close();
    });

    return {
        get url() {
            if (localAppAndPort === null) throw new InternalError("Test app has not initialized");
            return `http://localhost:${localAppAndPort.port}`;
        },
    };
}
