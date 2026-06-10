import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {DataLossError} from "~/shared/error/error.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    MessagePayload,
    MessageStream,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";

export type CommentQueryItem = {
    readonly sortRangeType: "Comments";
    readonly commentIndex: number;
    readonly createdTime: Date;
    readonly createdTimeZone: TimeZone;
    readonly authorId: AccountId;
    readonly payload: MessagePayload;
    readonly updateLockVersion?: number;
};

export type CommentQueryStreamItem = {
    readonly sortRangeType: "Comments#Stream";
    readonly commentIndex: number;
    readonly createdTime: Date;
    readonly partCount: number;
    readonly completedTime: Date | null;
    readonly lastPingTime: Date | null;
};

export type CommentQueryStreamPartItem = {
    readonly sortRangeType: "Comments#StreamPart";
    readonly commentIndex: number;
    readonly partIndex: number;
    readonly payload: MessageStreamPartPayload;
    readonly createdTime: Date;
    readonly updateLockVersion?: number;
};

/**
 * Takes a DynamoDB async iterable query for some comments in either ascending or
 * descending order and groups them so stream parts are added to a single comment
 * object.
 *
 * `processMessagesQuery()` is the exact same but uses the identifier "message"
 * instead of "comment" where appropriate.
 */
export async function* processCommentsQuery(
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

        let stream: (MessageStream & {readonly lastPingTime: Date | null}) | null = null;

        if (
            currentItem.payload.type !== "Content" ||
            currentItem.payload.clerical?.type !== "Stream"
        ) {
            if (currentStreamItem !== null || currentStreamPartItems !== null) {
                throw new DataLossError("Stream items found for comment that isn\u2019t a stream");
            }
        } else {
            if (currentStreamItem === null) {
                throw new DataLossError("Stream item not found for comment that is a stream");
            }

            const parts =
                currentStreamPartItems?.map(partItem => ({
                    version: partItem.updateLockVersion ?? 0,
                    payload: partItem.payload,
                    createdTime: partItem.createdTime,
                })) ?? [];

            if (parts.length !== currentStreamItem.partCount) {
                throw new DataLossError("Stream part item count mismatch");
            }

            stream = {
                completedTime: currentStreamItem.completedTime,
                lastPingTime: currentStreamItem.lastPingTime,
                createdTime: currentStreamItem.createdTime,
                parts,
            };
        }

        const comment: MessageItem = {
            index: currentItem.commentIndex,
            version: currentItem.updateLockVersion ?? 0,
            createdTime: currentItem.createdTime,
            createdTimeZone: currentItem.createdTimeZone,
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
                const comment = yieldCurrentItem();
                if (comment !== null) yield comment;

                currentItem = item;
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
