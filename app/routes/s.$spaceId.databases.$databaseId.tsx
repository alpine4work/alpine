import {Outlet, useParams} from "@remix-run/react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {createDatabaseConnection} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
import {DatabaseTablesContext} from "~/client/web/databases/database_tables_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDynamoGeneralRealtimeQuery} from "~/client/web/dynamo/use_dynamo_general_realtime_query.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useBrowserId} from "~/client/web/remix/client_info_context.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {fetchDatabaseAction} from "~/server/databases/data/fetch_database_action.js";
import {getDatabaseMetadata} from "~/server/databases/data/get_database_metadata.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {
    DynamoGeneralRealtimeQueryResult,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {
    backfillDatabaseMetadata,
    getDatabaseMetadata as getDatabaseMetadataRpc,
    updateDatabaseName,
} from "~/shared/rpc/databases_rpc_definitions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

const LoaderSchema = Schema.object({
    databaseMetadataResult: createDynamoGeneralRealtimeQuerySchema(DatabaseModel.schema()),
    tables: Schema.map(
        Schema.id<DatabaseTableId>(),
        Schema.object({
            name: Schema.string,
            tableName: Schema.string,
        }),
    ),
    pages: Schema.array(
        Schema.object({
            pageIndex: Schema.integer,
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});

export const meta = createMetaFunction(LoaderSchema, ({data}) => {
    const firstItem = data.databaseMetadataResult.items[0];
    return [{title: firstItem ? firstItem.model.name : "Database"}];
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    const databaseMetadataResult = await getDatabaseMetadata(context, databaseId);

    const {result, readPages} = await fetchDatabaseAction(context, databaseId, {
        name: "getTables",
        input: {},
    });

    const pages = Array.from(readPages, ([pageIndex, {timestamp, data}]) => ({
        pageIndex,
        timestamp,
        data,
    }));

    return jsonWithSchema(LoaderSchema, {
        databaseMetadataResult,
        tables: result.tables,
        pages,
    });
}

export default function DatabaseLayoutRoute() {
    const {databaseMetadataResult, tables, pages} = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);
    const context = useAppContext();
    const browserId = useBrowserId();
    const navigate = useNavigate();
    const reporter = useReporter();
    const searchEntityRegistry = useSearchEntityRegistry();
    const basePath = `/s/${params.spaceId}/databases/${databaseId}`;
    const [editingName, setEditingName] = useState(false);
    const [db] = useState(createDatabaseConnection);
    const conn = db.connection;
    const initialPagesRef = useRef(pages);

    useSearchAffinityViewEntityInteraction(`Database:${databaseId}`);

    const wsUrl = `/api/durable-objects/databases/${databaseId}?browserId=${browserId}`;

    const {isConnected, subscribeToEvents, subscribeToPongs, procedures} = useWebSocket(
        "DatabaseService",
        DatabaseRealtimeProtocol,
        wsUrl,
    );

    // Keep database metadata up-to-date in realtime.
    const {query: metadataQuery, handleEvent: handleEventForMetadata} =
        useDynamoGeneralRealtimeQuery(
            databaseMetadataResult as DynamoGeneralRealtimeQueryResult<DatabaseModel>,
            {
                isConnected,
                subscribeToPongs,
                subscribeToEvents: useCallback(
                    subscriber =>
                        subscribeToEvents(event => {
                            if (event.type === "RealtimeEventTransaction") {
                                subscriber(event.eventTransaction);
                            }
                        }),
                    [subscribeToEvents],
                ),
                backfillQuery: useCallback(
                    async checkpoint => {
                        const {backfillDatabaseResult} = await backfillDatabaseMetadata(context, {
                            databaseId,
                            checkpoint,
                        });
                        return backfillDatabaseResult;
                    },
                    [context, databaseId],
                ),
                reloadQuery: useCallback(async () => {
                    const {databaseResult} = await getDatabaseMetadataRpc(context, {databaseId});
                    return databaseResult;
                }, [context, databaseId]),
            },
        );

    const databaseItem = metadataQuery.getFirstItemIfExists();
    assert(databaseItem?.model instanceof DatabaseModel);
    const database = databaseItem.model;
    const databaseName = database.name;

    // Update `SearchEntityRegistry` with the latest database
    // name. As the name changes in realtime, any
    // `SearchEntityModel`s rendered elsewhere in the product
    // will also update.
    useMemo(() => {
        return searchEntityRegistry.getEntityStore(
            new SearchEntityModel({
                id: `Database:${databaseId}`,
                title: databaseName,
                titleVersion: {type: "Integer", version: databaseItem.version},
                media: null,
            }),
        );
    }, [databaseName, databaseId, databaseItem.version, searchEntityRegistry]);

    // Handle page-level events from the WebSocket.
    const handlePagesChanged = useEvent((event: DatabaseRealtimeEvent) => {
        if (event.type === "PagesChanged") {
            conn.call("writePagesFromRealtime", {
                pages: event.pages,
                mutationId: event.mutationId,
                fileSizeInPages: event.fileSizeInPages,
            });
        }
    });

    useEffect(() => {
        return subscribeToEvents(handlePagesChanged);
    }, [handlePagesChanged, subscribeToEvents]);

    const {executeActionServer, ensureCacheIsUpToDate, acknowledgePages, reportError} = useEvents({
        executeActionServer: async (
            action: {name: "rawSql"; input: {readonly sql: string}},
            options: {
                mutationId: DatabaseMutationId;
                returnResult?: boolean;
                returnPages?: boolean;
            },
        ) => {
            return procedures.executeAction({
                action,
                mutationId: options.mutationId,
                returnResult: options.returnResult ?? true,
                returnPages: options.returnPages ?? true,
            });
        },
        ensureCacheIsUpToDate: async (pageTimestampsByIndex: ReadonlyMap<number, number>) => {
            return procedures.ensureCacheIsUpToDate({pageTimestampsByIndex});
        },
        acknowledgePages: (pageIndexes: ReadonlyArray<number>) => {
            void procedures.acknowledgePages({pageIndexes: [...pageIndexes]});
        },
        reportError: (message: string) => {
            reporter.displayError("Couldn\u2019t save changes", new InternalError(message));
        },
    });

    const connectDatabase = useEvent(() => {
        db.connect({
            databaseId,
            initialPages: initialPagesRef.current,
            executeActionServer,
            ensureCacheIsUpToDate,
            acknowledgePages,
            reportError,
        }).catch((error: unknown) => {
            reporter.displayError(
                "Couldn\u2019t connect to database",
                error instanceof Error ? error : new InternalError(String(error)),
            );
        });
    });

    useEffect(() => {
        connectDatabase();
        return () => {
            conn.close();
        };
    }, [connectDatabase, conn, databaseId]);

    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            gap="3"
            padding="4"
        >
            {editingName ? (
                <DatabaseNameEditor
                    databaseName={databaseName}
                    onSave={async (name: string) => {
                        const trimmed = name.trim();
                        if (trimmed.length === 0 || trimmed === databaseName) {
                            setEditingName(false);
                            return;
                        }
                        try {
                            const {eventTransaction} = await updateDatabaseName(context, {
                                databaseId,
                                name: trimmed,
                            });

                            setEditingName(false);

                            // Immediately apply the realtime event
                            // transaction so we don't wait for
                            // the WebSocket round-trip.
                            handleEventForMetadata(eventTransaction);
                        } catch (error) {
                            reporter.displayError("Couldn\u2019t rename database", error);
                            setEditingName(false);
                        }
                    }}
                    onCancel={() => setEditingName(false)}
                />
            ) : (
                <Box
                    fontSize="200"
                    fontStyle="semi-bold"
                    onDoubleClick={() => setEditingName(true)}
                    style={{cursor: "text"}}
                >
                    {databaseName}
                </Box>
            )}
            <Box display="flex" gap="1" flexWrap="wrap">
                {Array.from(tables, ([tableId, table]) => (
                    <Button
                        key={tableId}
                        variant={params.tableOrViewId === tableId ? "neutral" : "quieter"}
                        onPress={() => navigate(`${basePath}/${tableId}`, {stopPropagation: true})}
                        pressErrorTitle="Failed to navigate"
                    >
                        {table.name}
                    </Button>
                ))}
                <Button
                    variant={params.tableOrViewId == null ? "neutral" : "quieter"}
                    onPress={() => navigate(`${basePath}/sql`, {stopPropagation: true})}
                    pressErrorTitle="Failed to navigate"
                >
                    SQL
                </Button>
            </Box>
            <DatabaseTablesContext.Provider value={tables}>
                <DatabaseConnectionContext.Provider value={conn}>
                    <Outlet />
                </DatabaseConnectionContext.Provider>
            </DatabaseTablesContext.Provider>
        </Box>
    );
}

function DatabaseNameEditor({
    databaseName,
    onSave,
    onCancel,
}: {
    databaseName: string;
    onSave: (name: string) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(databaseName);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const input = inputRef.current;
        if (input) {
            input.focus();
            input.select();
        }
    }, []);

    return (
        <Box fontSize="200" fontStyle="semi-bold">
            <InputWithAutoGrowingWidth
                ref={inputRef}
                maxLength={maxLabelStringLength}
                value={name}
                onChange={event => setName(event.currentTarget.value)}
                onKeyDown={event => {
                    switch (event.key) {
                        case "Enter": {
                            event.preventDefault();
                            onSave(name);
                            break;
                        }
                        case "Escape": {
                            event.preventDefault();
                            onCancel();
                            break;
                        }
                    }
                }}
                onBlur={() => onSave(name)}
                textStyle={{
                    fontSize: "inherit",
                    fontWeight: "inherit",
                }}
            />
        </Box>
    );
}
