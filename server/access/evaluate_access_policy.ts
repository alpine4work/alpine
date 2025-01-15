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
    accountId: AccountId | null,
    accessPolicy: AccessPolicy,
    expectedAccessLevel: AccessLevel,
): Promise<boolean> {
    // If there's a `urlGrant` then everyone has access at this level. Even when
    // `accountId` is null or `accountId` does not have space access.
    //
    // NOCOMMIT: Test this. Also test that removed accounts fail this check even if
    // the access policy gives them access.
    if (
        accessPolicy.urlGrant !== null &&
        hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
    ) {
        return true;
    }

    // Anonymous users ONLY get access through `urlGrant`.
    if (accountId === null) return false;

    // If this account is not a space member they can't have access.
    //
    // Even if an account was previously a member, was removed, but is still listed
    // in the `AccessPolicy` they can't access. An account can only access the
    // resource if they're an active space member.
    if (!(await isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId))) {
        return false;
    }

    if (
        accessPolicy.defaultGrant !== null &&
        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
    ) {
        return true;
    }

    const accountGrant = accessPolicy.accountGrantById.get(accountId);
    if (accountGrant && hasAccessLevel(accountGrant.level, expectedAccessLevel)) {
        return true;
    }

    return false;
}
