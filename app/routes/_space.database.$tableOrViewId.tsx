import {useCallback, useEffect, useMemo, useState} from "react";
import {deserializeDatabaseTableIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {DatabaseGroupConnectionProvider} from "~/client/web/databases/database_group_connection_provider.js";
import {DatabaseQuery} from "~/client/web/databases/database_query.js";
import {DatabaseGridView} from "~/client/web/databases/grid_view/database_grid_view.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useRynamoItem} from "~/client/web/dynamo/use_rynamo_item.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {getDatabaseTableMetadataItem as getDatabaseTableMetadataItemForLoader} from "~/server/databases/data/database_table_metadata.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";
import {LoaderDatabaseActionResultSchemas} from "~/shared/databases/database_protocol_schemas.js";
import {DatabaseRealtimeProtocol} from "~/shared/databases/database_realtime_protocol.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {databaseViewTargetRowsPerPage} from "~/shared/databases/sqlite_constants.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseRowId,
    SiteId,
} from "~/shared/id/types/id_types.open_source.js";
import {getDatabaseTableMetadataItem} from "~/shared/rpc/database_tables_rpc_definitions.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

const LoaderSchema = Schema.object({
    databaseGroupId: Schema.id<DatabaseGroupId>(),
    schema: LoaderDatabaseActionResultSchemas.getViewSchema,
    tableMetadataItem: createRynamoItemSchema(DatabaseTableMetadataModel.schema()),
    accessPolicySiteById: Schema.map(Schema.id<SiteId>(), SitePreviewModel.schema),
    firstPage: Schema.object({
        endCursor: Schema.id<DatabaseRowId>().nullable(),
        pageResult: LoaderDatabaseActionResultSchemas.getViewRowsPage,
    }),
});

export const meta = createMetaFunction(LoaderSchema, ({data}) => [
    {title: data.tableMetadataItem.model.name ?? "Database"},
]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    // Views are not first-class metadata models yet, so this route currently accepts
    // only table IDs despite reserving a parameter name that can support both.
    const tableId = deserializeDatabaseTableIdForLoader(params.tableOrViewId);
    const tableMetadataItem = await getDatabaseTableMetadataItemForLoader(context, tableId, {
        consistency: "StrongWithinCache",
    });
    const {databaseGroupId} = tableMetadataItem.model;

    const schemaResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getViewSchema",
        input: {tableOrViewId: tableId},
    });

    const [{cursorResult, pageResult}, accessPolicySiteById] = await runAllPromises([
        // The page boundary depends on the cursor, so keep these requests ordered.
        (async () => {
            const cursorResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
                name: "getViewRowsPageCursor",
                input: {
                    tableOrViewId: tableId,
                    afterCursor: null,
                    limit: databaseViewTargetRowsPerPage,
                },
            });

            const pageResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
                name: "getViewRowsPage",
                input: {
                    tableOrViewId: tableId,
                    afterCursor: null,
                    endCursor: cursorResult.result.endCursor,
                },
            });
            return {cursorResult, pageResult};
        })(),
        (async () => {
            const accessPolicy = tableMetadataItem.model.accessPolicy;
            const accessPolicySiteById =
                accessPolicy.type === "Site"
                    ? new Map([
                          [accessPolicy.siteId, await getSitePreview(context, accessPolicy.siteId)],
                      ])
                    : new Map<SiteId, SitePreviewModel>();
            return accessPolicySiteById;
        })(),
    ]);

    return jsonWithSchema(LoaderSchema, {
        databaseGroupId,
        schema: {
            name: "getViewSchema",
            input: {tableOrViewId: tableId},
            output: schemaResult.result,
        },
        tableMetadataItem,
        accessPolicySiteById,
        firstPage: {
            endCursor: cursorResult.result.endCursor,
            pageResult: {
                name: "getViewRowsPage",
                input: {
                    tableOrViewId: tableId,
                    afterCursor: null,
                    endCursor: cursorResult.result.endCursor,
                },
                output: pageResult.result,
            },
        },
    });
}

export default function DatabaseViewRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    return (
        <DatabaseGroupConnectionProvider databaseGroupId={loaderData.databaseGroupId}>
            <DatabaseViewRouteContent />
        </DatabaseGroupConnectionProvider>
    );
}

function DatabaseViewRouteContent() {
    const context = useAppContext();
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const {tableOrViewId} = loaderData.schema.input;
    const input = useMemo(() => ({tableOrViewId}), [tableOrViewId]);
    const metadataWebSocketUrl = `/api/durable-objects/database-groups/${loaderData.databaseGroupId}`;
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
                    tableId: loaderData.tableMetadataItem.model.tableId,
                });
                return item;
            }, [context, loaderData.tableMetadataItem.model.tableId]),
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
            tableId={schemaResult.value.tableId}
            viewId={schemaResult.value.viewId}
            humanName={tableMetadataItem.model.name ?? schemaResult.value.humanName}
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
        query.listen(conn);
        return () => query.dispose();
    }, [query, conn]);

    return query;
}
