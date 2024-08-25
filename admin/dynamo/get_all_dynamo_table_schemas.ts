import glob from "fast-glob";
import {join as joinPath, relative} from "path";
import {dynamoCoreVisibilityBazelPackagePaths} from "~/admin/dynamo/dynamo_core_visibility.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
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
        getConstructedDynamoTableSchemaCount,
        recordConstructedDynamoTableSchemas,
    }: typeof import("~/server/dynamo/core/dynamo_table_schema.js") =
        // Even though we have a dependency on `//server/dynamo/core`, import it from
        // `runfilesPath` so all references are the same as when we import all the
        // modules below.
        await import(joinPath(runfilesRepoPath, "server/dynamo/core/dynamo_table_schema.js"));

    assert(
        getConstructedDynamoTableSchemaCount() === 0,
        'Some "DynamoTableSchema"s have already been constructed so won\'t be captured in our recording',
    );

    const {schemas, indexNamesByTableName} = await recordConstructedDynamoTableSchemas(async () => {
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
    });

    return {
        schemas: Array.from(schemas.values()).sort((schema1, schema2) =>
            defaultCompareStrings(schema1.getName(), schema2.getName()),
        ),
        indexNamesByTableName: Array.from(
            flatMapIterable(indexNamesByTableName, ([tableName, indexNames]) =>
                mapIterable(indexNames, indexName => ({tableName, indexName})),
            ),
        ).sort(
            (index1, index2) =>
                defaultCompareStrings(index1.tableName, index2.tableName) ||
                defaultCompareStrings(index1.indexName, index2.indexName),
        ),
    };
});

/**
 * Get all the `DynamoTableSchema`s in our codebase. Importing this file will
 * also import all the files in `server/dynamo` to make sure we find all
 * schemas.
 */
export async function getAllDynamoTableSchemas() {
    const {schemas} = await importAllDynamoTableSchemasPromise.get();
    return schemas;
}

/**
 * Get all index names for `DynamoTableSchema`s.
 *
 * This returns the names of indexes as they exist in the database, not as they
 * exist in code. Remember that multiple indexes may overload the same physical
 * index in the database.
 */
export async function getAllDynamoTableSchemaIndexNames() {
    const {indexNamesByTableName} = await importAllDynamoTableSchemasPromise.get();
    return indexNamesByTableName;
}
