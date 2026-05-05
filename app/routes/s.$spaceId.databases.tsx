import {Outlet, useParams} from "@remix-run/react";
import {useEffect, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {createDatabaseGroupConnection} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
import {DatabaseTablesContext} from "~/client/web/databases/database_tables_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useBrowserId} from "~/client/web/remix/client_info_context.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import {getMinId} from "~/shared/id/id.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Constant {@link DatabaseTableId} used to key the
 * single internal SQLite database. Once each table has
 * its own database this is replaced by per-table IDs.
 */
const mainDatabaseTableId = getMinId<DatabaseTableId>();

const LoaderSchema = Schema.object({
    databaseGroupId: Schema.id<DatabaseGroupId>(),
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

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Databases"}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpace(context, spaceId);

    const {result, readPages} = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getTables",
        input: {},
    });

    const pages = Array.from(readPages, ([pageIndex, {timestamp, data}]) => ({
        pageIndex,
        timestamp,
        data,
    }));

    return jsonWithSchema(LoaderSchema, {
        databaseGroupId,
        tables: result.tables,
        pages,
    });
}

export default function DatabaseGroupLayoutRoute() {
    const {databaseGroupId, tables, pages} = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const browserId = useBrowserId();
    const navigate = useNavigate();
    const reporter = useReporter();
    const basePath = `/s/${params.spaceId}/databases`;
    const [db] = useState(createDatabaseGroupConnection);
    const conn = db.connection;
    const initialPagesRef = useRef(pages);

    const wsUrl = `/api/durable-objects/database-groups/${databaseGroupId}?browserId=${browserId}`;

    const {subscribeToEvents, procedures} = useWebSocket(
        "DatabaseGroupService",
        DatabaseRealtimeProtocol,
        wsUrl,
    );

    const handlePagesChanged = useEvent((event: DatabaseRealtimeEvent) => {
        if (event.type === "PagesChanged") {
            const main = event.tables.get(mainDatabaseTableId);
            if (main === undefined) return;
            conn.call("writePagesFromRealtime", {
                pages: main.pages,
                mutationId: event.mutationId,
                fileSizeInPages: main.fileSizeInPages,
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
            const result = await procedures.executeAction({
                action,
                mutationId: options.mutationId,
                returnResult: options.returnResult ?? true,
                returnPages: options.returnPages ?? true,
            });
            return {
                result: result.result,
                readPages:
                    result.readPages === null
                        ? null
                        : (result.readPages.get(mainDatabaseTableId) ?? new Map()),
            };
        },
        ensureCacheIsUpToDate: async (pageTimestampsByIndex: ReadonlyMap<number, number>) => {
            const result = await procedures.ensureCacheIsUpToDate({
                pageTimestampsByIndex: new Map([[mainDatabaseTableId, pageTimestampsByIndex]]),
            });
            const main = result.tables.get(mainDatabaseTableId);
            return main ?? {updatedPages: new Map(), stalePageIndexes: [], fileSizeInPages: 0};
        },
        acknowledgePages: (pageIndexes: ReadonlyArray<number>) => {
            void procedures.acknowledgePages({
                pageIndexes: new Map([[mainDatabaseTableId, [...pageIndexes]]]),
            });
        },
        reportError: (message: string) => {
            reporter.displayError("Couldn’t save changes", new InternalError(message));
        },
    });

    const connectDatabase = useEvent(() => {
        db.connect({
            databaseGroupId,
            initialPages: initialPagesRef.current,
            executeActionServer,
            ensureCacheIsUpToDate,
            acknowledgePages,
            reportError,
        }).catch((error: unknown) => {
            reporter.displayError(
                "Couldn’t connect to database",
                error instanceof Error ? error : new InternalError(String(error)),
            );
        });
    });

    useEffect(() => {
        connectDatabase();
        return () => {
            conn.close();
        };
    }, [connectDatabase, conn, databaseGroupId]);

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
