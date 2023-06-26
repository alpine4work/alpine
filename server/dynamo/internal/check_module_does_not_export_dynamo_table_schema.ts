import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Verify that a module object does not export a `DynamoTableSchema`. We expect
 * `DynamoTableSchema`s to be private to the module where it was defined. This
 * is used by the generated `all_dynamo_tables.js` file.
 */
export function checkModuleDoesNotExportDynamoTableSchema(
    moduleName: string,
    module: {[key: string]: unknown},
) {
    for (const [moduleExportName, moduleExportValue] of Object.entries(module)) {
        if (moduleExportValue instanceof DynamoTableSchema) {
            throw new InternalError(
                quote`Module ${moduleName} exports a "DynamoTableSchema" as ${moduleExportName}, DynamoDB table schemas should be private to the module`,
            );
        }
    }
}
