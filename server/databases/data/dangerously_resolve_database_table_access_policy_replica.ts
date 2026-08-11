import type {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import type {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import type {AccessPolicy, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import type {DatabaseTableAccessPolicyRevision} from "~/shared/databases/database_table_access_policy_revision.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Resolve a table policy together with the versions needed to order its replicas.
 *
 * Dangerous because a `Site` policy source is read without authorizing the actor
 * against the site — a replica must resolve even when the acting account can't see
 * the source site (e.g. the durable object reconciles every table in a group on
 * behalf of whichever account's connection triggered it). The result must only be
 * used for authorization decisions or replicated to a trusted destination (the
 * group's durable object), never surfaced to the actor.
 */
export async function dangerouslyResolveDatabaseTableAccessPolicyReplica(
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
            const site =
                await context.sitesInjection.dangerouslyGetSiteAccessPolicyReplicaWithoutAuthorization(
                    accessPolicy.siteId,
                    options,
                );
            return {
                accessPolicy: site.accessPolicy,
                revision: {
                    tableMetadataVersion,
                    sourcePolicyVersion: site.version,
                },
            };
        }
        default:
            throw exhaustive(accessPolicy);
    }
}
