import {getChatMessageCount} from "~/server/chat/data/get_chat_message_count.js";
import {searchEntityMajorContributorCutOff} from "~/server/search/core/search_entity_major_contributor_cut_off.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export function getChatSearchEntityContributorIds(
    definition: {type: "Direct"} | {type: "Room"; creatorId: AccountId},
    messagesSummary: {
        unknownAuthorMessageCount: number;
        messageCountByAuthorId: ReadonlyMap<AccountId, number>;
    },
) {
    const contributorIds = new Map<AccountId, "Major" | "Minor">();
    const totalMessageCount = getChatMessageCount(messagesSummary);

    for (const [accountId, messageCount] of messagesSummary.messageCountByAuthorId) {
        contributorIds.set(
            accountId,
            messageCount / totalMessageCount >= searchEntityMajorContributorCutOff
                ? "Major"
                : "Minor",
        );
    }

    if (definition.type === "Room") {
        contributorIds.set(definition.creatorId, "Major");
    }

    return contributorIds;
}
