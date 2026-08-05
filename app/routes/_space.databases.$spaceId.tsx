import {Outlet} from "@remix-run/react";
import {useEffect, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {createDatabaseGroupConnection} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getDatabaseGroupIdForSpaceIfExists} from "~/server/spaces/get_database_group_id_for_space.js";
import {InternalError} from "~/shared/error/error.js";
import type {DatabaseGroupId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    databaseGroupId: Schema.id<DatabaseGroupId>().nullable(),
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Databases"}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpaceIfExists(context, spaceId);

    if (databaseGroupId === null) {
        return jsonWithSchema(LoaderSchema, {
            databaseGroupId: null,
        });
    }

    return jsonWithSchema(LoaderSchema, {
        databaseGroupId,
    });
}

export default function DatabaseGroupLayoutRoute() {
    const {databaseGroupId} = useLoaderDataWithSchema(LoaderSchema);

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
            {databaseGroupId === null ? (
                <Outlet />
            ) : (
                <ConnectedDatabaseGroup databaseGroupId={databaseGroupId} />
            )}
        </Box>
    );
}

function ConnectedDatabaseGroup({databaseGroupId}: {databaseGroupId: DatabaseGroupId}) {
    const reporter = useReporter();
    const [db] = useState(createDatabaseGroupConnection);
    const conn = db.connection;

    const wsUrl = `/api/durable-objects/database-groups/${databaseGroupId}`;

    const connectDatabase = useEvent(() => {
        db.connect({
            databaseGroupId,
            webSocketUrl: wsUrl,
            reportError: message => {
                reporter.displayError("Couldn\u2019t save changes", new InternalError(message));
            },
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
        <DatabaseConnectionContext.Provider value={conn}>
            <Outlet />
        </DatabaseConnectionContext.Provider>
    );
}
