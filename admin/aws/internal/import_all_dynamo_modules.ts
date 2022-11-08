import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
// Allow access to DynamoDB internals from `admin/aws`.
// eslint-disable-next-line no-internal-imports
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {InternalError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {quote} from "~/shared/helpers/string/quote";

const dynamoDirectoryPath = path.join(runfilesPath, "cyberworlds/server/dynamo");

/**
 * We ignore this file since it intentionally exports an instance of
 * `DynamoTableSchema`. We have a test that imports all DynamoDB modules,
 * including this module, and checks that we threw an error.
 */
const ignoredTestCanaryFilePath = "server/dynamo/internal/import_all_dynamo_modules_test_canary.js";

/**
 * Imports every module in our `server/dynamo` directory.
 *
 * Also checks that every module in the `server/dynamo` directory does not
 * export a `DynamoTableSchema`. We expect `DynamoTableSchema`s to be an
 * implementation detail of the module where it was defined.
 */
export async function importAllDynamoModules(
    options: {shouldNotIgnoreTestCanaryFile?: boolean} = {},
) {
    await importAllDynamoModulesInDirectory(dynamoDirectoryPath, options);
}

async function importAllDynamoModulesInDirectory(
    directoryPath: string,
    options: {shouldNotIgnoreTestCanaryFile?: boolean},
) {
    const fileNames = await fs.readdir(directoryPath);
    const modulePaths = fileNames.map(moduleName => path.join(directoryPath, moduleName));

    await runAllPromises(
        modulePaths.map(async modulePath => {
            const moduleStats = await fs.lstat(modulePath);

            if (moduleStats.isDirectory()) {
                await importAllDynamoModulesInDirectory(modulePath, options);
            } else if (
                // Import all transpiled JavaScript modules (exclude TypeScript files)
                /\.(js|mjs)$/.test(modulePath) &&
                // Don't import test files
                !/\.test\.[a-z]+$/.test(modulePath) &&
                // Ignore the test canary file unless we were told to not ignore it
                (options.shouldNotIgnoreTestCanaryFile ||
                    !modulePath.endsWith(`/${ignoredTestCanaryFilePath}`))
            ) {
                const importedModule = require(modulePath);

                for (const [moduleExportName, moduleExportValue] of Object.entries(
                    importedModule,
                )) {
                    if (moduleExportValue instanceof DynamoTableSchema) {
                        throw new InternalError(
                            quote`Module ${path.relative(
                                `${runfilesPath}/cyberworlds`,
                                modulePath,
                            )} exports a "DynamoTableSchema" as ${moduleExportName}, DynamoDB table schemas should be private to the module`,
                        );
                    }
                }
            }
        }),
    );
}
