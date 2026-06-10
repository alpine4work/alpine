import {
    NonEmptyReadonlyArray,
    assertNonEmptyReadonlyArray,
} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.js";

export function getRoomChatPreviewAccountIds(
    chatId: ChatId,
    chatCreatorId: AccountId,
    contributorIds: ReadonlyMap<AccountId, "Major" | "Minor">,
): NonEmptyReadonlyArray<AccountId> {
    const majorContributorIds: Array<AccountId> = [];
    const minorContributorIds: Array<AccountId> = [];

    let hasChatCreatorId = false;

    for (const [contributorId, contributorType] of contributorIds) {
        if (contributorId === chatCreatorId) hasChatCreatorId = true;

        if (contributorType === "Major") {
            majorContributorIds.push(contributorId);
        } else {
            minorContributorIds.push(contributorId);
        }
    }

    if (!hasChatCreatorId) majorContributorIds.push(chatCreatorId);

    const stableRandom = new StableRandom(`Chat:${chatId}`);

    majorContributorIds.sort(defaultCompareStrings);
    stableShuffleArray(stableRandom, "majorContributorIds", majorContributorIds);

    // Pick 3 accounts so we can filter out the actor account and still have 2
    // accounts.
    const previewAccountCount = 3;

    let previewAccountIds = majorContributorIds.slice(0, previewAccountCount);

    // If we don't have enough major contributors, add minor contributors.
    if (previewAccountIds.length < previewAccountCount) {
        minorContributorIds.sort(defaultCompareStrings);
        stableShuffleArray(stableRandom, "minorContributorIds", minorContributorIds);

        previewAccountIds = [
            ...previewAccountIds,
            ...minorContributorIds.slice(0, previewAccountCount - previewAccountIds.length),
        ];
    }

    // Will always have at least `chatCreatorId`.
    return assertNonEmptyReadonlyArray(previewAccountIds);
}
