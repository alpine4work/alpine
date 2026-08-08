import type {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import type {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import type {AccessPolicy, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import type {DatabaseTableAccessPolicyRevision} from "~/shared/databases/database_table_access_policy_revision.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Resolve a table policy together with the versions needed to order its replicas.
 */
export async function resolveDatabaseTableAccessPolicyReplica(
    context: ServerMinimalActionContext,
    accessPolicy: AccessPolicy,
    tableMetadataVersion: number,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    accessPolicy: LocalAccessPolicy;
    revision: DatabaseTableAccessPolicyRevision;
}> {
    switch (accessPolicy.type) {
        case "Local":
            return {
                accessPolicy,
                revision: {tableMetadataVersion, sourcePolicyVersion: 0},
            };
        case "Site": {
            const site = await context.sitesInjection.getSitePreview(accessPolicy.siteId, options);
            return {
                accessPolicy: site.initialData.accessPolicy,
                revision: {
                    tableMetadataVersion,
                    sourcePolicyVersion: site.initialData.version,
                },
            };
        }
        default:
            throw exhaustive(accessPolicy);
    }
}
