import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/spaces_table.js";
import {AccessLevel, AccessPolicy, hasAccessLevel} from "~/shared/access/access_policy.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Evaluates whether the `AccountId` has access to the access policy at
 * the provided access level.
 *
 * Returns true if the account has access.
 */
export async function evaluateAccessPolicy(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    accessPolicy: AccessPolicy,
    expectedAccessLevel: AccessLevel,
): Promise<boolean> {
    if (accessPolicy.defaultGrant !== null) {
        if (
            (await isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)) &&
            hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
        ) {
            return true;
        }
    }

    const accountGrant = accessPolicy.accountGrantById.get(accountId);
    if (accountGrant && hasAccessLevel(accountGrant.level, expectedAccessLevel)) {
        return true;
    }

    return false;
}
