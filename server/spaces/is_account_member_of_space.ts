import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    AuthorizeSpaceAccessContext,
    authorizeSpaceAccess,
} from "~/server/spaces/authorize_space_access.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {spaceAccountsCache} from "~/server/spaces/internal/space_accounts_cache.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError} from "~/shared/error/error.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SpaceRole, hasSpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Is the `accountId` a member of the provided `spaceId`?
 *
 * This function caches its result in `CacheContextModule` which is typically
 * scoped to the duration of an action.
 *
 * This function is mostly strongly consistent so you can safely call it in a
 * strongly consistent environment. It returns `true` with strong consistency but
 * `false` with weak consistency. False positives are acceptable since it's ok if a
 * user's access to a space lingers a bit after they've been removed from the
 * space. But false negatives means the user gets an error when trying to access a
 * space they just got access to which we want to avoid.
 */
export async function isAccountMemberOfSpace(
    context: AuthorizeSpaceAccessContext,
    spaceId: SpaceId,
    accountId: AccountId,
    expectedRole: SpaceRole = "Member",
): Promise<boolean> {
    await authorizeSpaceAccess(context, spaceId);
    return await isAccountMemberOfSpaceWithoutAuthorization(
        context,
        spaceId,
        accountId,
        expectedRole,
    );
}

/**
 * Same as `isAccountMemberOfSpace()` except we don't authorize that the actor has
 * access to the space. If an attacker had access to this function they could find
 * out information they're not allowed to see! (e.g. Does account X work for
 * company Y assuming they had the right `Id`s.) Use only when necessary. Prefer
 * `isAccountMemberOfSpace()` wherever possible.
 *
 * This function is mostly strongly consistent so you can safely call it in a
 * strongly consistent environment. It returns `true` with strong consistency but
 * `false` with weak consistency. False positives are acceptable since it's ok if a
 * user's access to a space lingers a bit after they've been removed from the
 * space. But false negatives means the user gets an error when trying to access a
 * space they just got access to which we want to avoid.
 */
export async function isAccountMemberOfSpaceWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    expectedRole: SpaceRole = "Member",
    options?: {allowInvitePending?: boolean},
): Promise<boolean> {
    // Check if all accounts in the space are cached...
    const accountsCacheData =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context,
            spaceId,
        );

    const accountFromCache = accountsCacheData?.accountById.get(accountId);
    if (
        accountFromCache &&
        (accountFromCache.initialData.space.state.type === "Active" ||
            (options?.allowInvitePending &&
                accountFromCache.initialData.space.state.type === "InvitePending"))
    ) {
        // Sanity check: Don't allow bot accounts to have admin roles.
        if (accountFromCache.botId && accountFromCache.initialData.space.role !== "Member") {
            throw new DataLossError("Bot account should always have a member role");
        }

        if (hasSpaceRole(accountFromCache.initialData.space.role, expectedRole)) {
            return true;
        }
    }

    // Read the item with eventual consistency (and context caching). This function
    // needs to return true with strong consistency but if the item exists an
    // eventually consistent read will be cheaper and faster. We'll try again with
    // strong consistency if this fails.
    const item1 = await getSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Eventual",
        // It's ok to call this function when expecting strong read consistency. This
        // authorization check is mostly strongly consistent since we retry with strong
        // consistency below if our eventually consistent read fails.
        allowsEventualReadConsistency: true,
    });
    if (
        item1 &&
        (item1.state.type === "Active" ||
            (options?.allowInvitePending && item1.state.type === "InvitePending"))
    ) {
        // Sanity check: Don't allow bot accounts to have admin roles.
        if (item1.botId && item1.role !== "Member") {
            throw new DataLossError("Bot account should always have a member role");
        }

        if (hasSpaceRole(item1.role, expectedRole)) {
            return true;
        }
    }

    // If the item wasn't present in any cache and wasn't present when we read with
    // eventual consistency then try finding the item again one last time with strong
    // consistency. Since we want to return `true` from this function with strong
    // consistency.
    const item2 = await getSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Strong",
    });
    if (
        item2 &&
        (item2.state.type === "Active" ||
            (options?.allowInvitePending && item2.state.type === "InvitePending"))
    ) {
        // Sanity check: Don't allow bot accounts to have admin roles.
        if (item2.botId && item2.role !== "Member") {
            throw new DataLossError("Bot account should always have a member role");
        }

        if (hasSpaceRole(item2.role, expectedRole)) {
            return true;
        }
    }

    // User is not a member of the space at all
    return false;
}
