import {useParams} from "@remix-run/react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseResultTable} from "~/client/web/databases/database_result_table.js";
import {useReactiveDatabaseQuery} from "~/client/web/databases/use_reactive_database_query.js";
import {Box} from "~/client/web/design/box.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {queryDatabase} from "~/server/databases/data/query_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {LoaderDatabaseQueryResultSchema} from "~/shared/databases/database_query_schema.js";

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    /* eslint-disable-next-line cyberworlds/string-quotes -- SQL literal */
    const result = await queryDatabase(context, databaseId, `SELECT * FROM "${params.tableName}"`);

    return jsonWithSchema(LoaderDatabaseQueryResultSchema, result);
}

export default function DatabaseTableRoute() {
    const {tableName} = useParams();
    const loaderData = useLoaderDataWithSchema(LoaderDatabaseQueryResultSchema);
    /* eslint-disable-next-line cyberworlds/string-quotes -- SQL literal */
    const sql = `SELECT * FROM "${tableName}"`;
    const result = useReactiveDatabaseQuery({sql, initialData: loaderData});

    if (result == null) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                Loading...
            </Box>
        );
    }
    if (!result.ok) {
        return (
            <pre
                className={sprinkles({
                    fontSize: "75",
                    fontStyle: "code",
                    color: "red-60",
                    padding: "2",
                })}
            >
                {result.error}
            </pre>
        );
    }
    return <DatabaseResultTable rows={result.value} />;
}
