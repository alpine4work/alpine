import {type ReactNode, useEffect, useState} from "react";
import {createDatabaseGroupConnection} from "~/client/web/databases/connect_to_database.js";
import {DatabaseConnectionContext} from "~/client/web/databases/database_connection_context.js";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import type {DatabaseGroupId} from "~/shared/id/types/id_types.open_source.js";

export function DatabaseGroupConnectionProvider({
    databaseGroupId,
    children,
}: {
    databaseGroupId: DatabaseGroupId;
    children: ReactNode;
}) {
    const reporter = useReporter();
    const [database] = useState(createDatabaseGroupConnection);
    const connection = database.connection;
    const webSocketUrl = `/api/durable-objects/database-groups/${databaseGroupId}`;

    const connectDatabase = useEvent(() => {
        database
            .connect({
                databaseGroupId,
                webSocketUrl,
                reportError: message => {
                    reporter.displayError("Couldn\u2019t save changes", new InternalError(message));
                },
            })
            .catch((error: unknown) => {
                reporter.displayError(
                    "Couldn\u2019t connect to database",
                    error instanceof Error ? error : new InternalError(String(error)),
                );
            });
    });

    useEffect(() => {
        connectDatabase();
        return () => {
            connection.close();
        };
    }, [connectDatabase, connection, databaseGroupId]);

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
            <DatabaseConnectionContext.Provider value={connection}>
                {children}
            </DatabaseConnectionContext.Provider>
        </Box>
    );
}
