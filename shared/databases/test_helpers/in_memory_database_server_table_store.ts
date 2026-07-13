import type {
    DatabaseServerTableRegistration,
    DatabaseServerTableStore,
} from "~/shared/databases/database_action_context.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * In-memory {@link DatabaseServerTableStore} for tests that exercise server-only
 * action paths against a raw SQLite handle (no {@link DatabaseServerStorage}
 * backing). Registrations are kept for assertions via {@link registrations}.
 */
export class InMemoryDatabaseServerTableStore implements DatabaseServerTableStore {
    readonly registrations = new Map<DatabaseTableId, DatabaseServerTableRegistration>();
    private readonly tableNames = new Map<DatabaseTableId, string>();

    registerTable(tableId: DatabaseTableId, registration: DatabaseServerTableRegistration): void {
        this.registrations.set(tableId, registration);
        this.tableNames.set(tableId, registration.tableName);
    }

    setTableName(tableId: DatabaseTableId, tableName: string): void {
        this.tableNames.set(tableId, tableName);
    }

    setTableAccessPolicy(): void {}

    isTableNameTaken(tableName: string, excludeTableId?: DatabaseTableId): boolean {
        for (const [tableId, existingName] of this.tableNames) {
            if (existingName === tableName && tableId !== excludeTableId) return true;
        }
        return false;
    }
}
