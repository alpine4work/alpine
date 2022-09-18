import fs from "fs-extra";
import path from "path";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {quote} from "~/shared/helpers/string/quote";

const dynamoDirectoryPath = path.join(repoDirectoryPath, "server/dynamo");

/**
 * We ignore this file since it intentionally exports an instance of
 * `DynamoTableSchema`. We have a test that imports all DynamoDB modules,
 * including this module, and checks that we threw an error.
 */
const ignoredTestCanaryFilePath = path.join(
    repoDirectoryPath,
    "server/dynamo/internal/import-all-dynamo-modules-test-canary.ts",
);

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

    const results = await Promise.allSettled(
        modulePaths.map(async modulePath => {
            const moduleStats = await fs.lstat(modulePath);

            if (moduleStats.isDirectory()) {
                await importAllDynamoModulesInDirectory(modulePath, options);
            } else if (
                // Import all JavaScript modules
                /\.(js|jsx|ts|tsx|mjs)$/.test(modulePath) &&
                // Don't import test files
                !/\.test\.[a-z]+$/.test(modulePath) &&
                // Ignore the test canary file unless we were told to not ignore it
                (options.shouldNotIgnoreTestCanaryFile || modulePath !== ignoredTestCanaryFilePath)
            ) {
                const importedModule = await import(modulePath);

                for (const [moduleExportName, moduleExportValue] of Object.entries(
                    importedModule,
                )) {
                    if (moduleExportValue instanceof DynamoTableSchema) {
                        throw new Error(
                            quote`Module ${path.relative(
                                repoDirectoryPath,
                                modulePath,
                            )} exports a "DynamoTableSchema" as ${moduleExportName}, DynamoDB table schemas should be private to the module`,
                        );
                    }
                }
            }
        }),
    );

    for (const result of results) {
        if (result.status === "rejected") {
            throw result.reason;
        }
    }
}
