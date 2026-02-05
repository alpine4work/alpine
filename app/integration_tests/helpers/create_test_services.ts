import {test} from "@playwright/test";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {
    TestServices,
    actuallyCreateIntegrationTestEnvironment,
} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Runs a test server for Playwright tests using the test context's DynamoDB.
 * Also sets that server as the base URL for future tests.
 */
export function createTestServices(): {
    context: TestActualContext;
    services: TestServices;
} {
    // Anything in this directory will be available in an `output.zip` file in the
    // `bazel-testlogs` directory. Put our service logs in this directory.
    const testUndeclaredOutputsPath = assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR);
    const testTmpdirPath = assertExists(process.env.TEST_TMPDIR);

    const {context, services} = actuallyCreateIntegrationTestEnvironment(test, {
        undeclaredOutputsDirectoryPath: testUndeclaredOutputsPath,
        createTemporaryDirectoryPath: async () => {
            if (!(await fs.pathExists(testTmpdirPath))) {
                await fs.mkdirs(testTmpdirPath);
            }

            return fs.mkdtemp(joinPath(testTmpdirPath, "cyberworlds_test_"));
        },
    });

    test.use({
        baseURL: async ({}, use) => {
            const baseUrl = await services.waitForBaseUrl();
            await use(baseUrl);
        },
    });

    return {context, services};
}
