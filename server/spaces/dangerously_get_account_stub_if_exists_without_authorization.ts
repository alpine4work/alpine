import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {getAccountIfExistsWithoutAuthorization} from "~/server/spaces/internal/get_account_if_exists_without_authorization.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Get an account through a provided space without authorizing the actor has access
 * to the space the account is in. This is dangerous and should only be called if
 * you know the actor is authorized to see a stub for the account through some
 * other means. For example, if a document is shared by URL and the actor is not a
 * member of the space the document is in, then the actor is allowed to see the
 * names of any mentioned accounts and nothing else.
 *
 * This function returns an `AccountModel` stub. A stub only contains the account's
 * name and nothing else. We return dummy data for all other required properties
 * like the time the account joined the space and whether the account was removed
 * from the space. The version of the `AccountModel` stub is also a negative
 * number. This way if merging a stub `AccountModel` with a non-stub `AccountModel`
 * the non-stub `AccountModel` will always override.
 */
export async function dangerouslyGetAccountStubIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<AccountModel | null> {
    const account = await getAccountIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        options,
    );
    if (!account) return null;

    const accountData = account.initialData;

    // The minimum value for a V8 SMI on 32-bit platforms ([source][1], [source][2]).
    // Small integers in V8 aren't stored on the heap.
    //
    // We add this to version numbers so the version of our stub `AccountModel` will
    // always be smaller of non-stub `AccountModel`s. If the client has a non-stub
    // `AccountModel` for the account then when merging `AccountModel`s the non-stub
    // will always win.
    //
    // It's technically possible for the account to update so many times that the
    // account's stub version will be a positive number. We don't mind since it should
    // be wildly unlikely for a client to have the first version of the `AccountModel`
    // loaded locally and try to merge it with a stub version of the same
    // `AccountModel` more than one billion updates later. Even if this happens the
    // resulting bugs should be very tame.
    //
    // We add 1 so a `nameVersion` of -1 is still an SMI.
    // `getAddSpaceAccountTransactionEntries()` uses a `nameVersion` of -1 for the
    // `pendingAccountData` of invited existing accounts.
    //
    // [1]:
    //     https://medium.com/fhinkel/v8-internals-how-small-is-a-small-integer-e0badc18b6da
    // [2]:
    //     https://github.com/v8/v8/blob/a9e3d9c7ec1345085c861af76e508d9591634530/include/v8.h#L253
    const smiMinValue = -(2 ** 30) + 1;

    return new AccountModel({
        id: account.id,
        version: accountData.version + smiMinValue,
        name: accountData.name,
        nameVersion: accountData.nameVersion + smiMinValue,
        botId: accountData.botId,
        // The account's reaction character is available publicly via entities shared by
        // URL when there's no avatar set. Since the character is used to determine the
        // avatar.
        reactionCharacter: !accountData.avatar ? accountData.reactionCharacter : null,
        space: {
            version: accountData.space.version + smiMinValue,
            addedTime: new Date(0),
            state: {type: "Active", activatedTime: new Date(0)},
            role: "Member",
        },
        avatar: accountData.avatar
            ? {
                  avatarId: accountData.avatar.avatarId,
                  version: accountData.avatar.version + smiMinValue,
                  content: accountData.avatar.content,
              }
            : null,
    });
}
