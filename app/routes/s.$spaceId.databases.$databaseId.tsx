import {Outlet, useParams} from "@remix-run/react";
import {useEffect, useRef, useState} from "react";
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
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useBrowserId} from "~/client/web/remix/client_info_context.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {fetchDatabaseAction} from "~/server/databases/data/fetch_database_action.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {updateDatabaseName} from "~/shared/rpc/databases_rpc_definitions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    databaseName: Schema.string,
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

export const meta = createMetaFunction(LoaderSchema, ({data}) => [{title: data.databaseName}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    const database = await getDatabase(context, databaseId);

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
        databaseName: database.model.name,
        tables: result.tables,
        pages,
    });
}

export default function DatabaseLayoutRoute() {
    const {
        databaseName: initialDatabaseName,
        tables,
        pages,
    } = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);
    const context = useAppContext();
    const browserId = useBrowserId();
    const navigate = useNavigate();
    const reporter = useReporter();
    const basePath = `/s/${params.spaceId}/databases/${databaseId}`;
    const [databaseName, setDatabaseName] = useState(initialDatabaseName);
    const [editingName, setEditingName] = useState(false);
    const [db] = useState(createDatabaseConnection);
    const conn = db.connection;
    const initialPagesRef = useRef(pages);

    useSearchAffinityViewEntityInteraction(`Database:${databaseId}`);

    const events = useEvents({
        handleEvent: (event: DatabaseRealtimeEvent) => {
            if (event.type === "PagesChanged") {
                conn.call("writePagesFromRealtime", {
                    pages: event.pages,
                    mutationId: event.mutationId,
                    fileSizeInPages: event.fileSizeInPages,
                });
            }
        },
    });

    const wsUrl = `/api/durable-objects/databases/${databaseId}?browserId=${browserId}`;

    const {procedures} = useWebSocket(
        "DatabaseService",
        DatabaseRealtimeProtocol,
        wsUrl,
        events.handleEvent,
    );

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
                            await updateDatabaseName(context, {databaseId, name: trimmed});
                            setDatabaseName(trimmed);
                        } catch (error) {
                            reporter.displayError("Couldn\u2019t rename database", error);
                        }
                        setEditingName(false);
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
