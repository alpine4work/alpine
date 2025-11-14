import {DataLossError} from "~/shared/error/error.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    MessagePayload,
    MessageStream,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";

type MessageQueryItem = {
    readonly sortRangeType: "Messages";
    readonly messageIndex: number;
    readonly createdTime: Date;
    readonly createdTimeZone: TimeZone;
    readonly authorId: AccountId;
    readonly payload: MessagePayload;
    readonly updateLockVersion?: number;
};

type MessageQueryStreamItem = {
    readonly sortRangeType: "Messages#Stream";
    readonly messageIndex: number;
    readonly partCount: number;
    readonly completedTime: Date | null;
};

type MessageQueryStreamPartItem = {
    readonly sortRangeType: "Messages#StreamPart";
    readonly messageIndex: number;
    readonly partIndex: number;
    readonly payload: MessageStreamPartPayload;
    readonly createdTime: Date;
    readonly updateLockVersion?: number;
};

export type MessageItem = {
    readonly index: number;
    readonly version: number;
    readonly createdTime: Date;
    readonly createdTimeZone: TimeZone;
    readonly authorId: AccountId;
    readonly payload: MessagePayload;
    readonly stream: MessageStream | null;
};

/**
 * Takes a DynamoDB async iterable query for some messages in either ascending
 * or descending order and groups them so stream parts are added to a single
 * message object.
 *
 * `processCommentsQuery()` is the exact same but uses the identifier "comment"
 * instead of "message" where appropriate.
 */
export async function* processMessagesQuery(
    direction: "Ascending" | "Descending",
    iterable: AsyncIterable<MessageQueryItem | MessageQueryStreamItem | MessageQueryStreamPartItem>,
): AsyncIterableIterator<MessageItem> {
    let currentItem: MessageQueryItem | null = null;
    let currentStreamItem: MessageQueryStreamItem | null = null;
    let currentStreamPartItems: Array<MessageQueryStreamPartItem> | null = null;

    const yieldCurrentItem = (): MessageItem | null => {
        if (currentItem === null) {
            if (currentStreamItem !== null || currentStreamPartItems !== null)
                throw new DataLossError("Stream items found but message item not found");

            return null;
        }

        let stream: {
            completedTime: Date | null;
            parts: Array<{payload: MessageStreamPartPayload; createdTime: Date; version: number}>;
        } | null = null;

        if (
            currentItem.payload.type !== "Content" ||
            currentItem.payload.clerical?.type !== "Stream"
        ) {
            if (currentStreamItem !== null || currentStreamPartItems !== null) {
                throw new DataLossError("Stream items found for message that isn’t a stream");
            }
        } else {
            if (currentStreamItem === null) {
                throw new DataLossError("Stream item not found for message that is a stream");
            }

            const parts =
                currentStreamPartItems?.map(partItem => ({
                    version: partItem.updateLockVersion ?? 0,
                    payload: partItem.payload,
                    createdTime: partItem.createdTime,
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

        const message: MessageItem = {
            index: currentItem.messageIndex,
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

        return message;
    };

    for await (const item of iterable) {
        switch (item.sortRangeType) {
            case "Messages": {
                if (direction === "Descending") {
                    currentItem = item;

                    const message = yieldCurrentItem();
                    if (message !== null) yield message;
                } else {
                    const message = yieldCurrentItem();
                    if (message !== null) yield message;

                    currentItem = item;
                }
                break;
            }
            case "Messages#Stream": {
                currentStreamItem = item;
                break;
            }
            case "Messages#StreamPart": {
                currentStreamPartItems ??= [];
                currentStreamPartItems.push(item);
                break;
            }
        }
    }

    {
        const message = yieldCurrentItem();
        if (message !== null) yield message;
    }
}
