import {redirect} from "@remix-run/node";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {fetchDatabaseAction} from "~/server/databases/data/fetch_database_action.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const {result} = await fetchDatabaseAction(context, databaseId, {
        name: "getTables",
        input: {},
    });

    const firstTableId = result.tables.keys().next().value;
    const target = firstTableId ?? "sql";

    return redirect(`/s/${spaceId}/databases/${databaseId}/${target}`);
}

export default function DatabaseIndexRoute() {
    return null;
}
