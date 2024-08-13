import glob from "fast-glob";
import {join as joinPath, relative} from "path";
import {dynamoCoreVisibilityBazelPackagePaths} from "~/admin/dynamo/dynamo_core_visibility.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {quote} from "~/shared/helpers/string/quote.js";

// Import all the JavaScript files in our `server` directory. Only the sources
// of `DYNAMO_CORE_VISIBILITY` files and their dependencies should be present.
// This will add to our set of constructed DynamoDB table schemas.
//
// We also make sure no module exports a `DynamoTableSchema` as table schemas
// must be private to the module.
const importAllDynamoTableSchemasPromise = new Lazy(async () => {
    const runfilesRepoPath = joinPath(runfilesPath, "cyberworlds");
    const paths = await glob(
        dynamoCoreVisibilityBazelPackagePaths.map(path =>
            joinPath(runfilesRepoPath, `${path}/**/*.js`),
        ),
    );

    const {
        DynamoTableSchema,
        finishInitializingAllDynamoTableSchemas,
        getAllConstructedDynamoTableSchemaIndexNames,
        getAllConstructedDynamoTableSchemas,
        setWillManuallyFinishInitializingAllDynamoTableSchemas,
    }: typeof import("~/server/dynamo/core/dynamo_table_schema.js") =
        // Even though we have a dependency on `//server/dynamo/core`, import it from
        // `runfilesPath` so all references are the same as when we import all the
        // modules below.
        await import(joinPath(runfilesRepoPath, "server/dynamo/core/dynamo_table_schema.js"));

    setWillManuallyFinishInitializingAllDynamoTableSchemas();

    try {
        await runAllPromises(
            paths.map(async path => {
                const module = await import(path);

                // Verify that a module object does not export a `DynamoTableSchema`. We expect
                // `DynamoTableSchema`s to be private to the module where it was defined.
                for (const [moduleExportName, moduleExportValue] of Object.entries(module)) {
                    if (moduleExportValue instanceof DynamoTableSchema) {
                        throw new InternalError(
                            quote`Module ${relative(
                                runfilesRepoPath,
                                path,
                            )} exports a "DynamoTableSchema" as ${moduleExportName}, DynamoDB table schemas should be private to the module where it was defined`,
                        );
                    }
                }
            }),
        );
    } finally {
        finishInitializingAllDynamoTableSchemas();
    }

    return {getAllConstructedDynamoTableSchemaIndexNames, getAllConstructedDynamoTableSchemas};
});

/**
 * Get all the `DynamoTableSchema`s in our codebase. Importing this file will
 * also import all the files in `server/dynamo` to make sure we find all
 * schemas.
 */
export async function getAllDynamoTableSchemas() {
    const {getAllConstructedDynamoTableSchemas} = await importAllDynamoTableSchemasPromise.get();
    return getAllConstructedDynamoTableSchemas();
}

/**
 * Get all index names for `DynamoTableSchema`s.
 *
 * This returns the names of indexes as they exist in the database, not as they
 * exist in code. Remember that multiple indexes may overload the same physical
 * index in the database.
 */
export async function getAllDynamoTableSchemaIndexNames() {
    const {getAllConstructedDynamoTableSchemaIndexNames} =
        await importAllDynamoTableSchemasPromise.get();
    return getAllConstructedDynamoTableSchemaIndexNames();
}
