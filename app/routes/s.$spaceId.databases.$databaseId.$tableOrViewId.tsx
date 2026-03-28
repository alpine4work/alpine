import {redirect} from "@remix-run/node";
import {useMemo} from "react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseGridView} from "~/client/web/databases/database_grid_view.js";
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
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    schema: LoaderDatabaseActionResultSchema,
    rows: LoaderDatabaseActionResultSchema,
});

export {LoaderSchema as ViewLoaderSchema};

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    // Verify the database exists.
    await getDatabase(context, databaseId);

    const tableOrViewId = params.tableOrViewId!;
    const actionInput = {tableOrViewId};

    const [schemaResult, rowsResult] = await runAllPromises([
        fetchDatabaseAction(context, databaseId, {name: "getViewSchema", input: actionInput}),
        fetchDatabaseAction(context, databaseId, {name: "getViewRows", input: actionInput}),
    ]);

    // If the user navigated with a table ID, redirect to
    // the resolved view ID for a canonical URL. Uses a
    // relative redirect so peek routes work correctly.
    if (schemaResult.result.viewId !== tableOrViewId) {
        const url = new URL(request.url);
        url.pathname = url.pathname.replace(/\/[^/]+$/, `/${schemaResult.result.viewId}`);
        return redirect(url.pathname + url.search);
    }

    return jsonWithSchema(LoaderSchema, {
        schema: {
            name: "getViewSchema",
            input: actionInput,
            output: schemaResult.result,
            readPages: schemaResult.readPages,
        },
        rows: {
            name: "getViewRows",
            input: actionInput,
            output: rowsResult.result,
            readPages: rowsResult.readPages,
        },
    });
}

export default function DatabaseViewRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const {tableOrViewId} = loaderData.schema.input as DatabaseActionInput<"getViewSchema">;
    const input = useMemo(() => ({tableOrViewId}), [tableOrViewId]);

    const schemaResult = useReactiveDatabaseAction({
        name: "getViewSchema",
        input,
        initialData: loaderData.schema,
    });
    const rowsResult = useReactiveDatabaseAction({
        name: "getViewRows",
        input,
        initialData: loaderData.rows,
    });

    if (schemaResult == null || rowsResult == null) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                Loading...
            </Box>
        );
    }
    if (!schemaResult.ok) {
        return (
            <pre
                className={sprinkles({
                    fontSize: "75",
                    fontStyle: "code",
                    color: "red-60",
                    padding: "2",
                })}
            >
                {schemaResult.error}
            </pre>
        );
    }
    if (!rowsResult.ok) {
        return (
            <pre
                className={sprinkles({
                    fontSize: "75",
                    fontStyle: "code",
                    color: "red-60",
                    padding: "2",
                })}
            >
                {rowsResult.error}
            </pre>
        );
    }
    return (
        <DatabaseGridView
            tableId={schemaResult.value.tableId}
            viewId={schemaResult.value.viewId}
            fields={schemaResult.value.fields}
            rows={rowsResult.value.rows}
        />
    );
}
