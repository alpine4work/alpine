import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseView} from "~/client/web/databases/database_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    DatabaseQueryRequestSchema,
    DatabaseQueryResponseSchema,
} from "~/shared/databases/database_query_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    tables: Schema.array(
        Schema.object({
            name: Schema.string,
        }),
    ),
    pages: Schema.array(
        Schema.object({
            pageIndex: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});

export {LoaderSchema as DatabaseLoaderSchema};

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Database"}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const result = await context.edge.fetchDurableObject(
        `/api/durable-objects/databases/${spaceId}/query`,
        {
            serviceName: "DatabaseService",
            route: "/api/durable-objects/databases/:databaseId/query",
            body: DatabaseQueryRequestSchema.serialize({
                sql: "SELECT name FROM sqlite_master WHERE type='table'",
            }),
        },
    );
    const {rows, pages} = DatabaseQueryResponseSchema.deserialize(result);

    return jsonWithSchema(LoaderSchema, {
        tables: rows as Array<{name: string}>,
        pages,
    });
}

export default function DatabaseRoute() {
    return <DatabaseView />;
}
