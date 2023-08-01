import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {
    OpensearchLocal,
    startOpensearchLocal,
} from "~/admin/opensearch/local/start_opensearch_local.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/shared/test_shared_hooks.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// This file should only run in a Node.js test environment. Either Jest
// or Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

export function createTestOpensearch() {
    // OpenSearch can take a while to startup so we need a longer test timeout.
    //
    // The timeout shouldn't be too long since it will make it harder to debug
    // actual test failures due to timeout.
    if (import.meta.jest) import.meta.jest.setTimeout(1000 * 20);

    let opensearchLocalPromise: {port: number; promise: Promise<OpensearchLocal>} | null = null;

    testSharedHooks.beforeAll(async () => {
        const tempPath = await fs.mkdtemp(
            joinPath(assertExists(process.env.TEST_TMPDIR), "cyberworlds_opensearch_local_"),
        );

        const port = await getPort();

        // OpenSearch can take a while to start up. Don't block test execution on it.
        opensearchLocalPromise = {
            port,
            promise: startOpensearchLocal({
                dataPath: joinPath(tempPath, "data"),
                logsPath: joinPath(tempPath, "logs"),
                port,
            }),
        };

        // Don't treat promise exceptions as unhandled. Will be handled in
        // `afterAll()`.
        opensearchLocalPromise.promise.catch(() => {});
    });

    testSharedHooks.afterAll(async () => {
        assert(opensearchLocalPromise);
        const opensearchLocal = await opensearchLocalPromise.promise;
        await opensearchLocal.stop();
    });

    return {
        getPort: () => {
            if (opensearchLocalPromise === null)
                throw new InternalError("OpenSearch local has not started");

            return opensearchLocalPromise.port;
        },
    };
}
