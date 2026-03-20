import {redirect} from "@remix-run/node";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {fetchDatabaseAction} from "~/server/databases/data/fetch_database_action.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const {result} = await fetchDatabaseAction(context, databaseId, {
        name: "getTables",
        input: {},
    });

    const firstTableId = result.tables.keys().next().value;
    const target = firstTableId ?? "sql";

    // Use a relative redirect so that peek routes (which re-export this
    // loader) redirect within the peek URL namespace instead of escaping
    // to the non-peek URL.
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/\/$/, "") + `/${target}`;
    return redirect(url.pathname + url.search);
}

export default function DatabaseIndexRoute() {
    return null;
}
