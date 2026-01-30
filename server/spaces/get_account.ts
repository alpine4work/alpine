import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    getAccountIfExistsWithoutAuthorization,
    getAccountWithoutAvatarIfExistsWithoutAuthorization,
} from "~/server/spaces/internal/get_account_if_exists_without_authorization.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

/**
 * Get an account through a provided space. We can only authorize whether you
 * have access to read an account by checking that both you and the account you
 * are trying to read are members of the same space.
 *
 * If the account does not exist, we return null. If the account does exist but
 * is not a member of the provided space we don't return null! Instead we
 * return an `AccountModel` with `AccountModel.initialData.space.state.type"`
 * as Removed
 *
 * Do not use this method for authorization purposes. Since we return an
 * `AccountModel` even if the account is removed. Instead use
 * `isAccountMemberOfSpace()` which returns false for removed accounts.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccountIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModel | null> {
    await authorizeSpaceAccess(context, spaceId);
    return getAccountIfExistsWithoutAuthorization(context, spaceId, accountId, options);
}

/**
 * Same as `getAccountIfExists()` but doesn't load the account's avatar.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccountWithoutAvatarIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Omit<AccountModelData, "avatar"> | null> {
    await authorizeSpaceAccess(context, spaceId);
    return getAccountWithoutAvatarIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        options,
    );
}

/**
 * Same as `getAccountIfExists()` but throws an error if the account can not
 * be found.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModel> {
    const account = await getAccountIfExists(context, spaceId, accountId, options);
    if (!account) throw createSpaceAccountNotFoundError();
    return account;
}

/**
 * Same as `getAccount()` but doesn't load the account's avatar.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccountWithoutAvatar(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Omit<AccountModelData, "avatar">> {
    const account = await getAccountWithoutAvatarIfExists(context, spaceId, accountId, options);
    if (!account) throw createSpaceAccountNotFoundError();
    return account;
}

export function createSpaceAccountNotFoundError() {
    return new NotFoundError("Can\u2019t find account in space", {
        displayMessage: errorDisplayMessage`This person doesn\u2019t exist. Try searching \u201Call people\u201D to see who else is here.`,
    });
}
