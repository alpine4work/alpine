import {Construct} from "constructs";
import {getAllConstructedDynamoTableSchemas} from "~/server/dynamo/internal/dynamo-table-schema";
import {importAllDynamoModules} from "~/server/dynamo/internal/import-all-dynamo-modules";

/**
 * Adds all DynamoDB AWS resources to the provided scope.
 *
 * We collect our DynamoDB AWS resources by importing every module in
 * `server/dynamo` and finding all the `DynamoTableSchema`s that were
 * constructed by those imported modules.
 */
export async function addAllDynamoAwsResources(scope: Construct) {
    await importAllDynamoModules();

    for (const tableSchema of getAllConstructedDynamoTableSchemas()) {
        tableSchema.addAwsResources(scope);
    }
}
