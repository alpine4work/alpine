import {redirect} from "@remix-run/node";
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
import {fetchDatabaseAction} from "~/server/databases/data/fetch_database_action.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    type DatabaseActionInput,
    LoaderDatabaseActionResultSchema,
} from "~/shared/databases/database_actions.js";

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const tableOrViewId = params.tableOrViewId!;
    const {result, readPages} = await fetchDatabaseAction(context, databaseId, {
        name: "getViewData",
        input: {tableOrViewId},
    });

    // If the user navigated with a table ID, redirect to
    // the resolved view ID for a canonical URL. Uses a
    // relative redirect so peek routes work correctly.
    if (result.viewId !== tableOrViewId) {
        const url = new URL(request.url);
        url.pathname = url.pathname.replace(/\/[^/]+$/, `/${result.viewId}`);
        return redirect(url.pathname + url.search);
    }

    return jsonWithSchema(LoaderDatabaseActionResultSchema, {
        name: "getViewData",
        input: {tableOrViewId},
        output: result,
        readPages,
    });
}

export default function DatabaseViewRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderDatabaseActionResultSchema);
    const {tableOrViewId} = loaderData.input as DatabaseActionInput<"getViewData">;
    const result = useReactiveDatabaseAction({
        name: "getViewData",
        input: useMemo(() => ({tableOrViewId}), [tableOrViewId]),
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
    return <DatabaseResultTable fields={result.value.fields} rows={result.value.rows} />;
}
