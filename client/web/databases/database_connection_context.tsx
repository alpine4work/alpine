/* eslint-disable react-refresh/only-export-components */

import {createContext, useContext} from "react";
import type {DatabaseWorkerConnection} from "~/client/web/databases/connect_to_database.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export const DatabaseConnectionContext = createContext<DatabaseWorkerConnection | null>(null);

/**
 * Returns the database connection from the nearest {@link
 * DatabaseConnectionContext} provider.
 */
export function useDatabaseConnection(): DatabaseWorkerConnection {
    const conn = useContext(DatabaseConnectionContext);
    assert(
        conn != null,
        "useDatabaseConnection must be used within a DatabaseConnectionContext provider",
    );
    return conn;
}
