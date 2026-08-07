import {hashMd5} from "~/server/helpers/node/hash_md5.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {decodeIdInto, encodeId} from "~/shared/id/id.open_source.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * When sending a message to a set of accounts but we don't know the `ChatId` for
 * the conversation, we guess an optimistic `ChatId` which is a hash of the
 * accounts and the space. If this chat exists and has only the provided members
 * then great! We use it. If this chat does not exist then we create it. If the
 * chat does exist but has different members or is in a different space then we
 * need to create a new chat.
 */
export function getOptimisticChatId(
    spaceId: SpaceId,
    accountIds: ReadonlyArray<AccountId>,
): ChatId {
    assert(accountIds.length > 0);

    let isAlreadySorted = true;
    let lastAccountId: AccountId | undefined;
    for (const accountId of accountIds) {
        if (lastAccountId !== undefined && accountId <= lastAccountId) {
            isAlreadySorted = false;
            break;
        }
        lastAccountId = accountId;
    }

    const allSortedAccountIds = isAlreadySorted
        ? accountIds
        : Array.from(new Set(accountIds)).sort();

    const optimisticChatIdHashKey = new ArrayBuffer(16 * (allSortedAccountIds.length + 1));
    decodeIdInto(spaceId, new Uint8Array(optimisticChatIdHashKey, 0, 16));
    for (let i = 0; i < allSortedAccountIds.length; i++) {
        const accountId = allSortedAccountIds[i]!;
        decodeIdInto(accountId, new Uint8Array(optimisticChatIdHashKey, 16 * (i + 1), 16));
    }

    // Our optimistic `ChatId` is an MD5 hash of all the accounts we want to message
    // and the space we want to message in. MD5 is not suitable for secure
    // applications! However, we do not need security guarantees here, this is a
    // performance optimization. We use MD5 since it is fast and it outputs as 128-bit
    // value. Our `Id`s our 128-bit so this aligns quite well.
    return encodeId<ChatId>(new Uint8Array(hashMd5(optimisticChatIdHashKey)));
}
