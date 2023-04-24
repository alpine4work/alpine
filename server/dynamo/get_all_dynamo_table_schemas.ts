import "~/server/dynamo/all_dynamo_tables";

import {
    getAllConstructedDynamoTableSchemaIndexNames,
    getAllConstructedDynamoTableSchemas,
} from "~/server/dynamo/internal/dynamo_table_schema";

/**
 * Get all the `DynamoTableSchema`s in our codebase. Importing this file will
 * also import all the files in `server/dynamo` to make sure we find all
 * schemas.
 */
export function getAllDynamoTableSchemas() {
    return getAllConstructedDynamoTableSchemas();
}

/**
 * Get all index names for `DynamoTableSchema`s.
 *
 * This returns the names of indexes as they exist in the database, not as they
 * exist in code. Remember that multiple indexes may overload the same physical
 * index in the database.
 */
export function getAllDynamoTableSchemaIndexNames() {
    return getAllConstructedDynamoTableSchemaIndexNames();
}
