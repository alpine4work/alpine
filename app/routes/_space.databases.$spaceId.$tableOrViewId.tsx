import {redirect} from "@remix-run/node";
import {useCallback, useEffect, useMemo, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {DatabaseQuery} from "~/client/web/databases/database_query.js";
import {DatabaseGridView} from "~/client/web/databases/grid_view/database_grid_view.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useRynamoItem} from "~/client/web/dynamo/use_rynamo_item.js";
import {useBrowserId} from "~/client/web/remix/client_info_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {getDatabaseTableMetadataItem as getDatabaseTableMetadataItemForLoader} from "~/server/databases/data/database_table_metadata.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import {LoaderDatabaseActionResultSchemas} from "~/shared/databases/database_protocol_schemas.js";
import {DatabaseRealtimeProtocol} from "~/shared/databases/database_realtime_protocol.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {databaseViewTargetRowsPerPage} from "~/shared/databases/sqlite_constants.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import type {DatabaseGroupId, DatabaseRowId, SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {getDatabaseTableMetadataItem} from "~/shared/rpc/database_tables_rpc_definitions.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

const LoaderSchema = Schema.object({
    spaceId: Schema.id<SpaceId>(),
    databaseGroupId: Schema.id<DatabaseGroupId>(),
    schema: LoaderDatabaseActionResultSchemas.getViewSchema,
    tableMetadataItem: createRynamoItemSchema(DatabaseTableMetadataModel.schema()),
    accessPolicySiteById: Schema.map(Schema.id<SiteId>(), SitePreviewModel.schema),
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
    const schemaResult = await fetchDatabaseGroupAction(
        context,
        databaseGroupId,
        {
            name: "getViewSchema",
            input: {tableOrViewId},
        },
        {returnPages: false},
    );

    // If the user navigated with a table ID, redirect to the resolved view ID for a
    // canonical URL. Uses a relative redirect so peek routes work correctly.
    if (schemaResult.result.viewId !== tableOrViewId) {
        const url = new URL(request.url);
        url.pathname = url.pathname.replace(/\/[^/]+$/, `/${schemaResult.result.viewId}`);
        return redirect(url.pathname + url.search);
    }

    // Discover the cursor for the first page then fetch the page rows.
    const cursorResult = await fetchDatabaseGroupAction(
        context,
        databaseGroupId,
        {
            name: "getViewRowsPageCursor",
            input: {tableOrViewId, afterCursor: null, limit: databaseViewTargetRowsPerPage},
        },
        {returnPages: false},
    );

    const pageResult = await fetchDatabaseGroupAction(
        context,
        databaseGroupId,
        {
            name: "getViewRowsPage",
            input: {
                tableOrViewId,
                afterCursor: null,
                endCursor: cursorResult.result.endCursor,
            },
        },
        {returnPages: false},
    );
    const tableMetadataItem = await getDatabaseTableMetadataItemForLoader(context, {
        spaceId,
        tableId: schemaResult.result.tableId,
    });
    const accessPolicy = tableMetadataItem.model.accessPolicy;
    const accessPolicySiteById =
        accessPolicy.type === "Site"
            ? new Map([[accessPolicy.siteId, await getSitePreview(context, accessPolicy.siteId)]])
            : new Map<SiteId, SitePreviewModel>();

    return jsonWithSchema(LoaderSchema, {
        spaceId,
        databaseGroupId,
        schema: {
            name: "getViewSchema",
            input: {tableOrViewId},
            output: schemaResult.result,
        },
        tableMetadataItem,
        accessPolicySiteById,
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
            },
        },
    });
}

export default function DatabaseViewRoute() {
    const context = useAppContext();
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const {tableOrViewId} = loaderData.schema.input;
    const input = useMemo(() => ({tableOrViewId}), [tableOrViewId]);
    const browserId = useBrowserId();
    const metadataWebSocketUrl = `/api/durable-objects/database-groups/${loaderData.databaseGroupId}?browserId=${browserId}&trackPages=false`;
    const {isConnected, subscribeToEvents} = useWebSocket(
        "DatabaseGroupService",
        DatabaseRealtimeProtocol,
        metadataWebSocketUrl,
    );
    const {item: tableMetadataItem, handleEvents: handleTableMetadataEvents} = useRynamoItem(
        loaderData.tableMetadataItem,
        {
            isConnected,
            subscribeToEvents: useCallback(
                subscriber =>
                    subscribeToEvents(event => {
                        if (event.type === "TableMetadataChanged") {
                            subscriber(event.events);
                        }
                    }),
                [subscribeToEvents],
            ),
            reloadItemWithStrongReadConsistency: useCallback(async () => {
                const {item} = await getDatabaseTableMetadataItem(context, {
                    spaceId: loaderData.spaceId,
                    tableId: loaderData.tableMetadataItem.model.tableId,
                });
                return item;
            }, [context, loaderData.spaceId, loaderData.tableMetadataItem.model.tableId]),
        },
    );

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
            spaceId={loaderData.spaceId}
            tableId={schemaResult.value.tableId}
            viewId={schemaResult.value.viewId}
            tableName={schemaResult.value.tableName}
            initialAccessPolicy={tableMetadataItem.model.accessPolicy}
            accessPolicySiteById={loaderData.accessPolicySiteById}
            onTableMetadataEvents={handleTableMetadataEvents}
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
        query.listen({conn});
        return () => query.dispose();
    }, [query, conn]);

    return query;
}
