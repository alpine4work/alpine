import {Outlet, useParams} from "@remix-run/react";
import {useEffect, useState} from "react";
import {
    deserializeDatabaseIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {
    type DatabaseConnection,
    connectToDatabase,
} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {getDatabase} from "~/server/databases/data/get_database.js";
import {queryDatabase} from "~/server/databases/data/query_database.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import type {DatabaseId, DatabaseMutationId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    databaseName: Schema.string,
    tables: Schema.array(
        Schema.object({
            name: Schema.string,
            table_name: Schema.string,
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

export {LoaderSchema as DatabaseLoaderSchema};

export const meta = createMetaFunction(LoaderSchema, ({data}) => [{title: data.databaseName}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);

    const database = await getDatabase(context, databaseId);

    const {rows, pages} = await queryDatabase(
        context,
        databaseId,
        "SELECT name, table_name FROM _alpine_tables ORDER BY id",
    );

    return jsonWithSchema(LoaderSchema, {
        databaseName: database.model.name,
        tables: rows as Array<{name: string; table_name: string}>,
        pages,
    });
}

export default function DatabaseLayoutRoute() {
    const {databaseName, tables} = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const databaseId = deserializeDatabaseIdForLoader(params.databaseId);
    const navigate = useNavigate();
    const reporter = useReporter();
    const [conn, setConn] = useState<DatabaseConnection | null>(null);

    useSearchAffinityViewEntityInteraction(`Database:${databaseId}`);

    const events = useEvents({
        handleEvent: (event: DatabaseRealtimeEvent) => {
            if (event.type === "PagesChanged" && conn !== null) {
                conn.call("writePagesFromRealtime", {
                    pages: event.pages,
                    mutationId: event.mutationId,
                });
            }
        },
    });

    const wsUrl = `/api/durable-objects/databases/${databaseId}`;

    const {procedures} = useWebSocket(
        "DatabaseService",
        DatabaseRealtimeProtocol,
        wsUrl,
        events.handleEvent,
    );

    const {executeActionServer, ensureCacheIsUpToDate, reportError} = useEvents({
        executeActionServer: async (
            action: {name: "rawSql"; input: {readonly sql: string}},
            options: {mutationId: DatabaseMutationId},
        ) => {
            return procedures.executeAction({
                action,
                mutationId: options.mutationId,
            });
        },
        ensureCacheIsUpToDate: async (pageTimestampsByIndex: ReadonlyMap<number, number>) => {
            return procedures.ensureCacheIsUpToDate({pageTimestampsByIndex});
        },
        reportError: (message: string) => {
            reporter.displayError("Couldn\u2019t save changes", new InternalError(message));
        },
    });

    useEffect(() => {
        let connection: DatabaseConnection | null = null;
        (async () => {
            connection = await connectToDatabase({
                databaseId: databaseId as DatabaseId,
                executeActionServer,
                ensureCacheIsUpToDate,
                reportError,
            });
            setConn(connection);
        })();
        return () => {
            connection?.close();
        };
    }, [databaseId, executeActionServer, ensureCacheIsUpToDate, reportError]);

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
            <Box fontSize="200" fontStyle="semi-bold">
                {databaseName}
            </Box>
            <Box display="flex" gap="1" flexWrap="wrap">
                {tables.map(table => (
                    <Button
                        key={table.table_name}
                        variant={params.tableName === table.table_name ? "neutral" : "quieter"}
                        onPress={() =>
                            navigate(
                                `/s/${params.spaceId}/databases/${databaseId}/${table.table_name}`,
                            )
                        }
                        pressErrorTitle="Failed to navigate"
                    >
                        {table.name}
                    </Button>
                ))}
                <Button
                    variant={params.tableName == null ? "neutral" : "quieter"}
                    onPress={() => navigate(`/s/${params.spaceId}/databases/${databaseId}/sql`)}
                    pressErrorTitle="Failed to navigate"
                >
                    SQL
                </Button>
            </Box>
            <DatabaseConnectionContext.Provider value={conn}>
                <Outlet />
            </DatabaseConnectionContext.Provider>
        </Box>
    );
}
