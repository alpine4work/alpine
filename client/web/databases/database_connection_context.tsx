/* eslint-disable react-refresh/only-export-components */

import {createContext, useContext} from "react";
import type {DatabaseConnection} from "~/client/web/databases/connect_to_database.js";

export const DatabaseConnectionContext = createContext<DatabaseConnection | null>(null);

/**
 * Returns the database connection from the nearest
 * {@link DatabaseConnectionContext} provider. May be `null`
 * while the connection is still being established.
 */
export function useDatabaseConnection(): DatabaseConnection | null {
    return useContext(DatabaseConnectionContext);
}
