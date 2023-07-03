import {
    getAllDynamoTableSchemaIndexNames,
    getAllDynamoTableSchemas,
    // eslint-disable-next-line sort-imports-by-source
} from "../../dynamo/get_all_dynamo_table_schemas.js";

// eslint-disable-next-line no-console
console.log(
    `export const tracerEventDataDynamoConsumedCapacityKeys = ${JSON.stringify(
        [
            ...getAllDynamoTableSchemas().map(tableSchema => tableSchema.getName()),
            ...getAllDynamoTableSchemaIndexNames().map(
                ({tableName, indexName}) => `${tableName}_${indexName}`,
            ),
        ],
        null,
        4,
    )};`,
);
