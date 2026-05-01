import {redirect} from "@remix-run/node";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpace(context, spaceId);

    const {result} = await fetchDatabaseGroupAction(context, databaseGroupId, {
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

export default function DatabaseGroupIndexRoute() {
    return null;
}
