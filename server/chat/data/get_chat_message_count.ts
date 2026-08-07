import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * The total number of messages in a chat.
 */
export function getChatMessageCount(messagesSummary: {
    unknownAuthorMessageCount: number;
    messageCountByAuthorId: ReadonlyMap<AccountId, number>;
}): number {
    let messageCount = messagesSummary.unknownAuthorMessageCount;

    for (const count of messagesSummary.messageCountByAuthorId.values()) {
        messageCount += count;
    }

    return messageCount;
}

/**
 * Does the chat have any messages? Slightly more efficient than
 * `getChatMessageCount() > 0` for the same result.
 */
export function hasChatMessages(messagesSummary: {
    unknownAuthorMessageCount: number;
    messageCountByAuthorId: ReadonlyMap<AccountId, number>;
}): boolean {
    if (messagesSummary.unknownAuthorMessageCount > 0) return true;

    for (const count of messagesSummary.messageCountByAuthorId.values()) {
        if (count > 0) return true;
    }

    return false;
}
