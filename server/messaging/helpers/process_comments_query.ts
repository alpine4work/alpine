import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {DataLossError} from "~/shared/error/error.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessagePayload, MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

type CommentQueryItem = {
    readonly sortRangeType: "Comments";
    readonly commentIndex: number;
    readonly createdTime: Date;
    readonly authorId: AccountId;
    readonly payload: MessagePayload;
    readonly updateLockVersion?: number;
};

type CommentQueryStreamItem = {
    readonly sortRangeType: "Comments#Stream";
    readonly commentIndex: number;
    readonly partCount: number;
    readonly completedTime: Date | null;
};

type CommentQueryStreamPartItem = {
    readonly sortRangeType: "Comments#StreamPart";
    readonly commentIndex: number;
    readonly partIndex: number;
    readonly payload: MessageStreamPartPayload;
    readonly updateLockVersion?: number;
};

/**
 * Takes a DynamoDB async iterable query for some comments in either ascending
 * or descending order and groups them so stream parts are added to a single
 * comment object.
 *
 * `processMessagesQuery()` is the exact same but uses the identifier "message"
 * instead of "comment" where appropriate.
 */
export async function* processCommentsQuery(
    direction: "Ascending" | "Descending",
    iterable: AsyncIterable<CommentQueryItem | CommentQueryStreamItem | CommentQueryStreamPartItem>,
): AsyncIterableIterator<MessageItem> {
    let currentItem: CommentQueryItem | null = null;
    let currentStreamItem: CommentQueryStreamItem | null = null;
    let currentStreamPartItems: Array<CommentQueryStreamPartItem> | null = null;

    const yieldCurrentItem = (): MessageItem | null => {
        if (currentItem === null) {
            if (currentStreamItem !== null || currentStreamPartItems !== null)
                throw new DataLossError("Stream items found but comment item not found");

            return null;
        }

        let stream: {
            completedTime: Date | null;
            parts: Array<{version: number; payload: MessageStreamPartPayload}>;
        } | null = null;

        if (
            currentItem.payload.type !== "Content" ||
            currentItem.payload.clerical?.type !== "Stream"
        ) {
            if (currentStreamItem !== null || currentStreamPartItems !== null) {
                throw new DataLossError("Stream items found for comment that isn’t a stream");
            }
        } else {
            if (currentStreamItem === null) {
                throw new DataLossError("Stream item not found for comment that is a stream");
            }

            const parts =
                currentStreamPartItems?.map(partItem => ({
                    version: partItem.updateLockVersion ?? 0,
                    payload: partItem.payload,
                })) ?? [];

            // Since we queried in descending order, we need to reverse the parts to put
            // them in the right order.
            if (direction === "Descending") {
                parts.reverse();
            }

            if (parts.length !== currentStreamItem.partCount) {
                throw new DataLossError("Stream part item count mismatch");
            }

            stream = {
                completedTime: currentStreamItem.completedTime,
                parts,
            };
        }

        const comment: MessageItem = {
            index: currentItem.commentIndex,
            version: currentItem.updateLockVersion ?? 0,
            createdTime: currentItem.createdTime,
            authorId: currentItem.authorId,
            payload: currentItem.payload,
            stream,
        };

        currentItem = null;
        currentStreamItem = null;
        currentStreamPartItems = null;

        return comment;
    };

    for await (const item of iterable) {
        switch (item.sortRangeType) {
            case "Comments": {
                if (direction === "Descending") {
                    currentItem = item;

                    const comment = yieldCurrentItem();
                    if (comment !== null) yield comment;
                } else {
                    const comment = yieldCurrentItem();
                    if (comment !== null) yield comment;

                    currentItem = item;
                }
                break;
            }
            case "Comments#Stream": {
                currentStreamItem = item;
                break;
            }
            case "Comments#StreamPart": {
                currentStreamPartItems ??= [];
                currentStreamPartItems.push(item);
                break;
            }
        }
    }

    {
        const comment = yieldCurrentItem();
        if (comment !== null) yield comment;
    }
}
