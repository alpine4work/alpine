import {useParams} from "@remix-run/react";
import {useMemo} from "react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseResultTable} from "~/client/web/databases/database_result_table.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {queryDatabase} from "~/server/databases/data/query_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {databaseTableDataQuery} from "~/shared/databases/database_queries.js";
import {LoaderDatabaseQueryResultSchema} from "~/shared/databases/database_query_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const result = await queryDatabase(
        context,
        databaseId,
        databaseTableDataQuery(params.tableName!),
    );

    return jsonWithSchema(LoaderDatabaseQueryResultSchema, result);
}

export default function DatabaseTableRoute() {
    const {tableName} = useParams();
    assert(tableName != null);
    const loaderData = useLoaderDataWithSchema(LoaderDatabaseQueryResultSchema);
    const result = useReactiveDatabaseAction({
        name: "readonlyRawSql",
        input: useMemo(() => ({sql: databaseTableDataQuery(tableName)}), [tableName]),
        initialData: loaderData,
    });

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
    return <DatabaseResultTable rows={result.value.rows} />;
}
