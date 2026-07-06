import {redirect} from "@remix-run/node";
import {useEffect, useMemo, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {DatabaseQuery} from "~/client/web/databases/database_query.js";
import {DatabaseGridView} from "~/client/web/databases/grid_view/database_grid_view.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import {LoaderDatabaseActionResultSchemas} from "~/shared/databases/database_protocol_schemas.js";
import {databaseViewTargetRowsPerPage} from "~/shared/databases/sqlite_constants.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    schema: LoaderDatabaseActionResultSchemas.getViewSchema,
    firstPage: Schema.object({
        endCursor: Schema.id<DatabaseRowId>().nullable(),
        pageResult: LoaderDatabaseActionResultSchemas.getViewRowsPage,
    }),
});

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpace(context, spaceId);

    const tableOrViewId = params.tableOrViewId!;

    // Fetch schema first — needed for the redirect check.
    const schemaResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getViewSchema",
        input: {tableOrViewId},
    });

    // If the user navigated with a table ID, redirect to the resolved view ID for a
    // canonical URL. Uses a relative redirect so peek routes work correctly.
    if (schemaResult.result.viewId !== tableOrViewId) {
        const url = new URL(request.url);
        url.pathname = url.pathname.replace(/\/[^/]+$/, `/${schemaResult.result.viewId}`);
        return redirect(url.pathname + url.search);
    }

    // Discover the cursor for the first page then fetch the page rows.
    const cursorResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getViewRowsPageCursor",
        input: {tableOrViewId, afterCursor: null, limit: databaseViewTargetRowsPerPage},
    });

    const pageResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getViewRowsPage",
        input: {
            tableOrViewId,
            afterCursor: null,
            endCursor: cursorResult.result.endCursor,
        },
    });

    return jsonWithSchema(LoaderSchema, {
        schema: {
            name: "getViewSchema",
            input: {tableOrViewId},
            output: schemaResult.result,
            readPages: schemaResult.readPages,
        },
        firstPage: {
            endCursor: cursorResult.result.endCursor,
            pageResult: {
                name: "getViewRowsPage",
                input: {
                    tableOrViewId,
                    afterCursor: null,
                    endCursor: cursorResult.result.endCursor,
                },
                output: pageResult.result,
                readPages: pageResult.readPages,
            },
        },
    });
}

export default function DatabaseViewRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const {tableOrViewId} = loaderData.schema.input;
    const input = useMemo(() => ({tableOrViewId}), [tableOrViewId]);

    const schemaResult = useReactiveDatabaseAction({
        name: "getViewSchema",
        input,
        initialData: loaderData.schema,
    });
    useSearchAffinityViewEntityInteraction(
        schemaResult?.ok ? `DatabaseTable:${schemaResult.value.tableId}` : null,
    );

    const conn = useDatabaseConnection();
    const query = useDatabaseQuery(conn, tableOrViewId, loaderData.firstPage);

    if (schemaResult == null) {
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
    return (
        <DatabaseGridView
            tableId={schemaResult.value.tableId}
            viewId={schemaResult.value.viewId}
            fields={schemaResult.value.fields}
            query={query}
        />
    );
}

function useDatabaseQuery(
    conn: ReturnType<typeof useDatabaseConnection>,
    tableOrViewId: string,
    firstPage: SchemaType<typeof LoaderSchema>["firstPage"],
): DatabaseQuery {
    const [query] = useState(() => {
        return new DatabaseQuery({
            tableOrViewId,
            initialPage: {
                endCursor: firstPage.endCursor,
                fieldIndexes: firstPage.pageResult.output.fieldIndexes,
                rows: firstPage.pageResult.output.rows,
            },
        });
    });

    useEffect(() => {
        if (conn == null) return;
        query.listen({conn, readPages: firstPage.pageResult.readPages});
        return () => query.dispose();
    }, [query, conn]); // eslint-disable-line react-hooks/exhaustive-deps

    return query;
}
