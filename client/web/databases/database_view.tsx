import {ReactNode, useEffect, useState} from "react";
import {useParams} from "react-router";
import {
    type DatabaseConnection,
    connectToDatabase,
} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import type {DatabaseId, DatabaseMutationId} from "~/shared/id/types/id_types.js";

export interface DatabaseViewTable {
    readonly name: string;
    readonly tableName: string;
}

export function DatabaseLayout({
    name,
    tables,
    activeTableName,
    children,
}: {
    name: string;
    tables: ReadonlyArray<DatabaseViewTable>;
    activeTableName: string | null;
    children: ReactNode;
}) {
    const {spaceId, databaseId} = useParams();
    const navigate = useNavigate();
    const reporter = useReporter();
    const [conn, setConn] = useState<DatabaseConnection | null>(null);

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

    const wsUrl = databaseId ? `/api/durable-objects/databases/${databaseId}` : null;

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
                databaseId: databaseId! as DatabaseId,
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
                {name}
            </Box>
            <Box display="flex" gap="1" flexWrap="wrap">
                {tables.map(table => (
                    <Button
                        key={table.tableName}
                        variant={activeTableName === table.tableName ? "neutral" : "quieter"}
                        onPress={() =>
                            navigate(`/s/${spaceId}/databases/${databaseId}/${table.tableName}`)
                        }
                        pressErrorTitle="Failed to navigate"
                    >
                        {table.name}
                    </Button>
                ))}
                <Button
                    variant={activeTableName === null ? "neutral" : "quieter"}
                    onPress={() => navigate(`/s/${spaceId}/databases/${databaseId}/sql`)}
                    pressErrorTitle="Failed to navigate"
                >
                    SQL
                </Button>
            </Box>
            <DatabaseConnectionContext.Provider value={conn}>
                {children}
            </DatabaseConnectionContext.Provider>
        </Box>
    );
}
