import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {iterateMessageContentPayloadParentIndexes} from "~/shared/messaging/message_schema.js";

/**
 * Recursively loads messages referenced as parents that aren't already present in
 * `messageItems`.
 */
export async function getOtherReferencedMessageItems<Message>({
    messageItems,
    getMessageItem,
    mapper,
}: {
    messageItems: ReadonlyArray<MessageItem>;
    getMessageItem: (messageIndex: number) => Promise<MessageItem>;
    mapper: (messageItem: MessageItem) => Promise<Message>;
}): Promise<Array<Message>> {
    const loadedMessageIndexes = new Set(messageItems.map(({index}) => index));
    let referencedMessageIndexes = new Set<number>();
    const mappedMessagePromiseByIndex = new Map<number, Promise<Message>>();

    function loadParentIndexes(messageItem: MessageItem) {
        if (messageItem.payload.type !== "Content" || messageItem.payload.parent === null) return;

        for (const messageIndex of iterateMessageContentPayloadParentIndexes(
            messageItem.payload.parent,
        )) {
            if (loadedMessageIndexes.has(messageIndex)) continue;

            loadedMessageIndexes.add(messageIndex);
            referencedMessageIndexes.add(messageIndex);
        }
    }

    for (const messageItem of messageItems) {
        loadParentIndexes(messageItem);
    }

    while (referencedMessageIndexes.size > 0) {
        const messageIndexes = Array.from(referencedMessageIndexes);
        referencedMessageIndexes = new Set();

        await runAllPromises(
            messageIndexes.map(async messageIndex => {
                const messageItem = await getMessageItem(messageIndex);

                loadParentIndexes(messageItem);

                mappedMessagePromiseByIndex.set(messageIndex, mapper(messageItem));
            }),
        );
    }

    const sortedMappedMessagePromises = Array.from(mappedMessagePromiseByIndex)
        .sort(([messageIndex1], [messageIndex2]) => messageIndex1 - messageIndex2)
        .map(([, mappedMessagePromise]) => mappedMessagePromise);

    return await runAllPromises(sortedMappedMessagePromises);
}
