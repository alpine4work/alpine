import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    DatabaseQueryRequestSchema,
    DatabaseQueryResponseSchema,
    type LoaderDatabaseQueryResult,
} from "~/shared/databases/database_query_schema.js";
import type {DatabaseId} from "~/shared/id/types/id_types.js";

/**
 * Executes a SQL query against a database's durable object and
 * returns the result in a shape suitable for loader responses.
 */
export async function queryDatabase(
    context: ServerActionContext,
    databaseId: DatabaseId,
    sql: string,
): Promise<LoaderDatabaseQueryResult> {
    const result = await context.edge.fetchDurableObject(
        `/api/durable-objects/databases/${databaseId}/query`,
        {
            serviceName: "DatabaseService",
            route: "/api/durable-objects/databases/:databaseId/query",
            body: DatabaseQueryRequestSchema.serialize({sql}),
        },
    );
    const {rows, readPages} = DatabaseQueryResponseSchema.deserialize(result);

    return {
        sql,
        rows,
        pages: Array.from(readPages, ([pageIndex, {timestamp, data}]) => ({
            pageIndex,
            timestamp,
            data,
        })),
    };
}
