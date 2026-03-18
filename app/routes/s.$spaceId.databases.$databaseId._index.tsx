import {redirect} from "@remix-run/node";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {queryDatabase} from "~/server/databases/data/query_database.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {databaseFirstTableQuery} from "~/shared/databases/database_queries.js";

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const {rows} = await queryDatabase(context, databaseId, databaseFirstTableQuery());

    const firstTable = rows[0] as {table_name: string} | undefined;
    const target = firstTable ? firstTable.table_name : "sql";

    return redirect(`/s/${spaceId}/databases/${databaseId}/${target}`);
}

export default function DatabaseIndexRoute() {
    return null;
}
