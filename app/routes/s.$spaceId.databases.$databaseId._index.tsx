import {useParams} from "@remix-run/react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseView} from "~/client/web/databases/database_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    DatabaseQueryRequestSchema,
    DatabaseQueryResponseSchema,
} from "~/shared/databases/database_query_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    databaseName: Schema.string,
    tables: Schema.array(
        Schema.object({
            name: Schema.string,
        }),
    ),
    pages: Schema.array(
        Schema.object({
            pageIndex: Schema.integer,
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});

export {LoaderSchema as DatabaseLoaderSchema};

export const meta = createMetaFunction(LoaderSchema, ({data}) => [{title: data.databaseName}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    const database = await getDatabase(context, databaseId);

    const result = await context.edge.fetchDurableObject(
        `/api/durable-objects/databases/${databaseId}/query`,
        {
            serviceName: "DatabaseService",
            route: "/api/durable-objects/databases/:databaseId/query",
            body: DatabaseQueryRequestSchema.serialize({
                sql: "SELECT name FROM sqlite_master WHERE type='table'",
            }),
        },
    );
    const {rows, readPages} = DatabaseQueryResponseSchema.deserialize(result);

    return jsonWithSchema(LoaderSchema, {
        databaseName: database.model.name,
        tables: rows as Array<{name: string}>,
        pages: Array.from(readPages, ([pageIndex, {timestamp, data}]) => ({
            pageIndex,
            timestamp,
            data,
        })),
    });
}

export default function DatabaseRoute() {
    const {databaseName} = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    useSearchAffinityViewEntityInteraction(`Database:${databaseId}`);

    return <DatabaseView name={databaseName} />;
}
