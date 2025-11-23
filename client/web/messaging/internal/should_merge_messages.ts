import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";

const mergeMessageMinuteLimit = 5;

/**
 * Should two messages merge together?
 */
export function shouldMergeMessages<RoomKey extends string>(
    message1: MessageModel<RoomKey> | OptimisticMessageModel,
    message2: MessageModel<RoomKey> | OptimisticMessageModel,
): boolean {
    // Don't merge optimistic requests with an error.
    if (message1.isOptimistic && message1.optimisticRequestErrorState.hasError) return false;
    if (message2.isOptimistic && message2.optimisticRequestErrorState.hasError) return false;

    // Never merge clerical messages. We may change the account name in a clerical
    // message. We don't want the modified account name to be lost when merging
    // with the previous message or considered to apply to later messages.
    if (message1.payload.type === "Content" && message1.payload.clerical) return false;
    if (message2.payload.type === "Content" && message2.payload.clerical) return false;

    return (
        message1.author.id === message2.author.id &&
        Math.abs(differenceInMinutes(message1.createdTime, message2.createdTime)) <
            mergeMessageMinuteLimit &&
        (message2.payload.type !== "Content" || message2.payload.parent === null)
    );
}
