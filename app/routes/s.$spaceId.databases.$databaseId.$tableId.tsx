import {useParams} from "@remix-run/react";
import {useMemo} from "react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseResultTable} from "~/client/web/databases/database_result_table.js";
import {useDatabaseTables} from "~/client/web/databases/database_tables_context.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {fetchDatabaseAction} from "~/server/databases/data/fetch_database_action.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {databaseTableDataQuery} from "~/shared/databases/database_queries.js";
import {LoaderDatabaseQueryResultSchema} from "~/shared/databases/database_query_schema.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const {result, readPages} = await fetchDatabaseAction(context, databaseId, {
        name: "getTableData",
        input: {tableId: params.tableId! as DatabaseTableId},
    });

    const pages = Array.from(readPages, ([pageIndex, {timestamp, data}]) => ({
        pageIndex,
        timestamp,
        data,
    }));

    return jsonWithSchema(LoaderDatabaseQueryResultSchema, {
        sql: databaseTableDataQuery(result.tableName),
        rows: result.rows,
        pages,
    });
}

export default function DatabaseTableRoute() {
    const {tableId} = useParams();
    const tables = useDatabaseTables();
    const loaderData = useLoaderDataWithSchema(LoaderDatabaseQueryResultSchema);
    const tableName = tables?.get(tableId as DatabaseTableId)?.tableName ?? null;
    const result = useReactiveDatabaseAction({
        name: "readonlyRawSql",
        input: useMemo(
            () => (tableName != null ? {sql: databaseTableDataQuery(tableName)} : null),
            [tableName],
        ),
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
