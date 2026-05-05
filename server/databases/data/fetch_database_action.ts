import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {
    type DatabaseActionInput,
    type DatabaseActionName,
    type DatabaseActionObject,
    DatabaseActionObjectSchema,
    type DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getMinId} from "~/shared/id/id.js";
import type {DatabaseGroupId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Constant {@link DatabaseTableId} used to key the
 * single internal SQLite database. Once each table has
 * its own database this is replaced by per-table IDs.
 */
const mainDatabaseTableId = getMinId<DatabaseTableId>();

/**
 * Executes a database action against a database group's durable
 * object via HTTP and returns the typed result along with
 * the pages read during execution.
 */
export async function fetchDatabaseGroupAction<N extends DatabaseActionName>(
    context: ServerActionContext,
    databaseGroupId: DatabaseGroupId,
    actionObject: {name: N; input: DatabaseActionInput<N>},
): Promise<{
    result: DatabaseActionOutput<N>;
    readPages: ReadonlyMap<number, {timestamp: number; data: Uint8Array}>;
}> {
    const body = DatabaseActionObjectSchema.serialize(actionObject as DatabaseActionObject);
    const response = await context.edge.fetchDurableObject(
        `/api/durable-objects/database-groups/${databaseGroupId}/action`,
        {
            serviceName: "DatabaseGroupService",
            route: "/api/durable-objects/database-groups/:databaseGroupId/action",
            body,
        },
    );
    const {result, readPages} = DatabaseActionFetchResponseSchema.deserialize(
        response as SchemaSerializedValue,
    );
    assert(result.name === actionObject.name);
    return {
        result: result.output as DatabaseActionOutput<N>,
        readPages: readPages.get(mainDatabaseTableId) ?? new Map(),
    };
}
