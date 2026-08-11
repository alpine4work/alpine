import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {dangerouslyResolveDatabaseTableAccessPolicyReplica} from "~/server/databases/data/dangerously_resolve_database_table_access_policy_replica.js";
import {DatabasesRynamo} from "~/server/databases/data/internal/databases_rynamo.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpaceIdForDatabaseGroupId} from "~/server/spaces/get_database_group_id_for_space.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import type {DatabaseTableAccessPolicyRevision} from "~/shared/databases/database_table_access_policy_revision.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import type {DatabaseGroupId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Resolve the access policy replicas for a set of tables in a database group, for
 * the group durable object's periodic reconciliation.
 *
 * Dangerous because the result contains each table's resolved policy without a
 * per-table `View` check — only space access is authorized. The result must only
 * go to the group's durable object (which already stores every table's policy
 * copy), never to a client.
 *
 * Reads are eventually consistent on purpose: the durable object applies each
 * replica through a monotonic revision guard, so a stale read is a no-op and the
 * next reconciliation pass retries.
 */
export async function dangerouslyGetDatabaseGroupAccessPolicyReplicasForDurableObject(
    context: ServerActionContext,
    {
        databaseGroupId,
        tableIds,
    }: {
        databaseGroupId: DatabaseGroupId;
        tableIds: ReadonlyArray<DatabaseTableId>;
    },
): Promise<
    Map<
        DatabaseTableId,
        {
            accessPolicy: LocalAccessPolicy;
            revision: DatabaseTableAccessPolicyRevision;
        }
    >
> {
    const spaceId = await getSpaceIdForDatabaseGroupId(context, databaseGroupId);
    await authorizeSpaceAccess(context, spaceId);

    const replicas = await runAllPromises(
        tableIds.map(async tableId => {
            const item = await DatabasesRynamo.getItemIfExists(context, {
                partitionType: "Table",
                sortRangeType: "Attributes",
                tableId,
            });
            // Skip ids with no metadata item or an item outside the group instead of failing
            // the whole reconciliation pass — the durable object keeps its current copy for
            // them.
            if (item === null || item.databaseGroupId !== databaseGroupId) return null;
            const replica = await dangerouslyResolveDatabaseTableAccessPolicyReplica(
                context,
                item.accessPolicy,
                item.updateLockVersion ?? 0,
            );
            return {tableId, replica};
        }),
    );

    const replicaByTableId = new Map<
        DatabaseTableId,
        {
            accessPolicy: LocalAccessPolicy;
            revision: DatabaseTableAccessPolicyRevision;
        }
    >();
    for (const entry of replicas) {
        if (entry === null) continue;
        replicaByTableId.set(entry.tableId, entry.replica);
    }
    return replicaByTableId;
}
