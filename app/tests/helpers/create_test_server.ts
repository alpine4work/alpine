import {test} from "@playwright/test";
import getPort from "get-port";
import {LocalServer, createLocalServer} from "~/app/local/create_local_server";
import {TestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {assert} from "~/shared/helpers/control/assert";

export function createTestServer(context: TestContext) {
    let localServer: LocalServer | null = null;
    const portPromise = getPort();

    test.use({
        baseURL: async ({}, use) => {
            const port = await portPromise;
            await use(`http://localhost:${port}`);
        },
    });

    test.beforeAll(async () => {
        const port = await portPromise;

        const _localServer = createLocalServer({
            bindings: {
                DYNAMO_LOCAL_PORT: context.getDynamoLocalPort(),
            },
        });

        await new Promise<void>(resolve => {
            _localServer.server.listen(port, () => resolve());
        });

        localServer = _localServer;
    });

    test.afterAll(async () => {
        assert(localServer !== null);
        localServer.server.close();
    });
}
