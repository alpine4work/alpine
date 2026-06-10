import {Outlet, useParams} from "@remix-run/react";
import {useEffect, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {createDatabaseGroupConnection} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
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
import {DatabasePagesSchema} from "~/shared/databases/database_protocol_schemas.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    databaseGroupId: Schema.id<DatabaseGroupId>(),
    pages: DatabasePagesSchema,
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Databases"}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpace(context, spaceId);

    const {readPages} = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "listTableIds",
        input: {},
    });

    return jsonWithSchema(LoaderSchema, {
        databaseGroupId,
        pages: readPages,
    });
}

export default function DatabaseGroupLayoutRoute() {
    const {databaseGroupId, pages} = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const browserId = useBrowserId();
    const navigate = useNavigate();
    const reporter = useReporter();
    const basePath = `/databases/${params.spaceId}`;
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
            conn.call("writePageDiffsFromRealtime", {
                pageDiffs: event.pageDiffs,
                mutationId: event.mutationId,
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
        ensureCacheIsUpToDate: async (
            pageVersionsByIndex: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, number>>,
        ) => {
            return procedures.ensureCacheIsUpToDate({pageVersionsByIndex});
        },
        acknowledgePages: (pageIndexes: ReadonlyMap<DatabaseTableId, ReadonlyArray<number>>) => {
            void procedures.acknowledgePages({pageIndexes});
        },
        reportError: (message: string) => {
            reporter.displayError("Couldn\u2019t save changes", new InternalError(message));
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
                <Button
                    variant={params.tableOrViewId == null ? "neutral" : "quieter"}
                    onPress={() => navigate(`${basePath}/sql`, {stopPropagation: true})}
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
