/* eslint-disable react-refresh/only-export-components */

import {createContext, useContext} from "react";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

export interface DatabaseTableInfo {
    readonly name: string;
    readonly tableName: string;
}

export const DatabaseTablesContext = createContext<ReadonlyMap<
    DatabaseTableId,
    DatabaseTableInfo
> | null>(null);

/**
 * Returns the tables map from the nearest
 * {@link DatabaseTablesContext} provider. May be `null`
 * while the layout data is loading.
 */
export function useDatabaseTables(): ReadonlyMap<DatabaseTableId, DatabaseTableInfo> | null {
    return useContext(DatabaseTablesContext);
}
