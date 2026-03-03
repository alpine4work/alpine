import fs from "fs-extra";
import {join as joinPath} from "path";
import {
    TestActualContext,
    actuallyCreateUnitTestEnvironment,
} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";

// This file should only run in a Node.js test environment. Either Jest or
// Playwright.
assert(process.release.name === "node");
assert(process.env.NODE_ENV === "test");

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 *
 * The context has all the modules in `AppProcessContext` and you can easily create
 * `AppActionContext`s.
 *
 * - By default, we don't render emails for this test context since rendering
 *   happens asynchronously and may cause tests that use waitForTestTasks to hang.
 *   Set `shouldRenderEmails: true` if you need to render emails in your tests..
 *
 * - By default, we don't start OpenSearch for this test context since it's slow to
 *   start. Set `shouldStartOpensearch: true` if you need to write tests against
 *   OpenSearch.
 *
 * - By default, ignore jobs in the local test process. Provide `processJob` to
 *   process a job in the local text context. Provide `shouldSendJobsToSqs` to add
 *   your jobs to a local SQS server so a `JobConsumer` can process them instead of
 *   processing them locally.
 */
export function createTestContext(
    options: DistributiveOmit<
        Parameters<typeof actuallyCreateUnitTestEnvironment>[1],
        "undeclaredOutputsDirectoryPath" | "createTemporaryDirectoryPath"
    > = {},
): TestActualContext {
    // Increase Jest timeout for tests using a test context since these tests need to
    // interact with the database which may be slow.
    //
    // The timeout shouldn't be too long since it will make it harder to debug actual
    // test failures due to timeout.
    if (import.meta.jest) {
        // HACK: If the test file raises the timeout by calling
        // `import.meta.jest.setTimeout()` to something larger than 10s we don't want to
        // lower that test file specific timeout back down to 10s (e.g.
        // `feed_table.test.ts`).
        //
        // Looking at the Jest source code `import.meta.jest.setTimeout()` [writes to a
        // symbol on the global object][1] and later that [symbol is read to determine the
        // test's timeout][2].
        //
        // We hook into this mechanism to read the current test timeout and use it if it's
        // greater than 10s to make sure we're not lowering the timeout.
        //
        // [1]:
        //     https://github.com/jestjs/jest/blob/edee3ab3a8290b220970e2f32212b6a91d6ca8cd/packages/jest-runtime/src/index.ts#L2308-L2311
        // [2]:
        //     https://github.com/jestjs/jest/blob/edee3ab3a8290b220970e2f32212b6a91d6ca8cd/packages/jest-circus/src/eventHandler.ts#L229-L233
        const testTimeoutSymbol = Symbol.for("TEST_TIMEOUT_SYMBOL");

        const oldTestTimeout: unknown = (globalThis as any)[testTimeoutSymbol];
        assert(typeof oldTestTimeout === "number" || oldTestTimeout === undefined);

        // If a test file called `import.meta.jest.setTimeout()` before
        // `createTestContext()` (e.g. `feed_table.test.ts`) and the timeout is greater
        // than 10s, then use the previous timeout from the first
        // `import.meta.jest.setTimeout()` call.
        const minTestTimeout = 1000 * 10;
        const newTestTimeout =
            oldTestTimeout !== undefined && oldTestTimeout > minTestTimeout
                ? oldTestTimeout
                : minTestTimeout;

        import.meta.jest.setTimeout(newTestTimeout);

        // Double check that our hack works and that `import.meta.jest.setTimeout()`
        // actually updates the global `testTimeoutSymbol` property.
        assert((globalThis as any)[testTimeoutSymbol] === newTestTimeout);
    }

    // Anything in this directory will be available in an `output.zip` file in the
    // `bazel-testlogs` directory. Put our service logs in this directory.
    const testUndeclaredOutputsPath = assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR);
    const testTmpdirPath = assertExists(process.env.TEST_TMPDIR);

    return actuallyCreateUnitTestEnvironment(testSharedHooks, {
        ...options,
        undeclaredOutputsDirectoryPath: testUndeclaredOutputsPath,
        createTemporaryDirectoryPath: async () => {
            if (!(await fs.pathExists(testTmpdirPath))) {
                await fs.mkdirs(testTmpdirPath);
            }

            return fs.mkdtemp(joinPath(testTmpdirPath, "cyberworlds_test_"));
        },
    });
}
