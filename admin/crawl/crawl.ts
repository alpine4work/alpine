import glob from "fast-glob";
import {join as joinPath, relative} from "path";
import {dynamoCoreVisibilityBazelPackagePaths} from "~/admin/crawl/dynamo_core_visibility.js";
import {opensearchVisibilityBazelPackagePaths} from "~/admin/crawl/opensearch_visibility.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

// Import all the JavaScript files in `DYNAMO_CORE_VISIBILITY` and
// `OPENSEARCH_VISIBILITY`. This will collect all constructed DynamoDB table
// schemas and OpenSearch indexes.
//
// We also make sure no module exports a `DynamoTableSchema` or `OpensearchIndex`
// as those objects must be private to the module.
const crawlPromise = new Lazy(async () => {
    const runfilesRepoPath = joinPath(runfilesPath, "cyberworlds");
    const paths = await glob([
        ...dynamoCoreVisibilityBazelPackagePaths.map(path =>
            joinPath(runfilesRepoPath, `${path}/**/*.js`),
        ),
        ...opensearchVisibilityBazelPackagePaths.map(path =>
            joinPath(runfilesRepoPath, `${path}/**/*.js`),
        ),
    ]);

    const [
        {
            DynamoTableSchema,
            getConstructedDynamoTableSchemaCount,
            recordConstructedDynamoTableSchemas,
        },
        {RynamoTableSchema},
        {OpensearchIndex, getConstructedOpensearchIndexCount, recordConstructedOpensearchIndexes},
    ]: [
        typeof import("~/server/dynamo/core/dynamo_table_schema.js"),
        typeof import("~/server/rynamo/rynamo_table_schema.js"),
        typeof import("~/server/opensearch/opensearch_index.js"),
    ] = await runAllPromises([
        // Even though we have a dependencies on `//server/dynamo/core` and
        // `//server/opensearch`, import these files from `runfilesPath` so all references
        // are the same as when we import all the modules below.
        import(joinPath(runfilesRepoPath, "server/dynamo/core/dynamo_table_schema.js")),
        import(joinPath(runfilesRepoPath, "server/rynamo/rynamo_table_schema.js")),
        import(joinPath(runfilesRepoPath, "server/opensearch/opensearch_index.js")),
    ]);

    assert(
        getConstructedDynamoTableSchemaCount() === 0,
        "Some `DynamoTableSchema`s have already been constructed so won\u2019t be captured in our recording",
    );
    assert(
        getConstructedOpensearchIndexCount() === 0,
        "Some `OpensearchIndex`s have already been constructed so won\u2019t be captured in our recording",
    );

    const [
        {tableSchemas: dynamoTableSchemas, indexNamesByTableName: dynamoIndexNamesByTableName},
        {indexes: opensearchIndexes},
    ] = await recordConstructedDynamoTableSchemas(async () => {
        const [recording] = await recordConstructedOpensearchIndexes(async () => {
            await runAllPromises(
                paths.map(async path => {
                    const module = await import(path);
                    const pathParts = path.split("/");
                    const lastDirectoryName = pathParts[pathParts.length - 2]; // Get second-to-last element (last is filename)
                    if (lastDirectoryName === "internal") {
                        // We allow these sensitive exports within internal packages
                        return;
                    }

                    // Verify that a module object does not export a `DynamoTableSchema` or
                    // `OpensearchIndex`. We expect `DynamoTableSchema`s to be private to the module
                    // where it was defined.
                    for (const [moduleExportName, moduleExportValue] of Object.entries(module)) {
                        if (moduleExportValue instanceof DynamoTableSchema) {
                            throw new InternalError(
                                quote`Module ${relative(
                                    runfilesRepoPath,
                                    path,
                                )} exports a \`DynamoTableSchema\` as ${moduleExportName}, DynamoDB table schemas should be private to the package where it was defined`,
                            );
                        }

                        if (moduleExportValue instanceof RynamoTableSchema) {
                            throw new InternalError(
                                quote`Module ${relative(
                                    runfilesRepoPath,
                                    path,
                                )} exports a \`RynamoTableSchema\` as ${moduleExportName}, DynamoDB table schemas should be private to the package where it was defined`,
                            );
                        }

                        if (moduleExportValue instanceof OpensearchIndex) {
                            throw new InternalError(
                                quote`Module ${relative(
                                    runfilesRepoPath,
                                    path,
                                )} exports an \`OpensearchIndex\` as ${moduleExportName}, OpenSearch indexes should be private to the package where it was defined`,
                            );
                        }
                    }
                }),
            );
        });

        return recording;
    });

    return {
        dynamoTableSchemas: Array.from(dynamoTableSchemas.values()).sort((schema1, schema2) =>
            defaultCompareStrings(schema1.getName(), schema2.getName()),
        ),
        dynamoIndexNamesByTableName: Array.from(
            flatMapIterable(dynamoIndexNamesByTableName, ([tableName, indexNames]) =>
                mapIterable(indexNames, indexName => ({tableName, indexName})),
            ),
        ).sort(
            (index1, index2) =>
                defaultCompareStrings(index1.tableName, index2.tableName) ||
                defaultCompareStrings(index1.indexName, index2.indexName),
        ),
        opensearchIndexes: Array.from(opensearchIndexes.values()).sort((index1, index2) =>
            defaultCompareStrings(index1.name, index2.name),
        ),
    };
});

/**
 * Get all the `DynamoTableSchema`s in our codebase. Calling this function imports
 * all files in `server` that depend on `server/dynamo/core` to make sure we find
 * all schemas.
 */
export async function crawlDynamoTableSchemas() {
    const {dynamoTableSchemas} = await crawlPromise.get();
    return dynamoTableSchemas;
}

/**
 * Get all index names for `DynamoTableSchema`s.
 *
 * This returns the names of indexes as they exist in the database, not as they
 * exist in code. Remember that multiple indexes may overload the same physical
 * index in the database.
 */
export async function crawlDynamoTableSchemaIndexNames() {
    const {dynamoIndexNamesByTableName} = await crawlPromise.get();
    return dynamoIndexNamesByTableName;
}

/**
 * Get all the `OpensearchIndex`s in our codebase. Calling this function will
 * import all the files in our `server` directory that use `server/opensearch` to
 * make sure we find all indexes.
 */
export async function crawlOpensearchIndexes() {
    const {opensearchIndexes} = await crawlPromise.get();
    return opensearchIndexes;
}
