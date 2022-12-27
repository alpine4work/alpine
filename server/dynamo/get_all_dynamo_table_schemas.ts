import "~/server/dynamo/all_dynamo_tables";

import {getAllConstructedDynamoTableSchemas} from "~/server/dynamo/internal/dynamo_table_schema";

/**
 * Get all the `DynamoTableSchema`s in our codebase. Importing this file will
 * also import all the files in `server/dynamo` to make sure we find all
 * schemas.
 */
export function getAllDynamoTableSchemas() {
    return getAllConstructedDynamoTableSchemas();
}
