import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {DataLossError, FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

/**
 * Validates a `MessagesRange` parent based on the messages within
 */
export function validateMessageContentPayloadMessagesRangeParent(
    parent: MessageContentPayloadParent & {readonly type: "MessagesRange"},
    messageItems: Array<MessageItem>,
) {
    // The following should be true since they're
    // `MessageContentPayloadParentSchema` validations. We `assert()` here to
    // double check.
    assert(parent.startIndex <= parent.endIndex);
    assert(parent.startIndex !== parent.endIndex || parent.startVersion === parent.endVersion);
    assert(parent.startIndex !== parent.endIndex || parent.startPos <= parent.endPos);

    const startMessageItem = messageItems[0];
    const endMessageItem = messageItems[messageItems.length - 1];

    if (
        !startMessageItem ||
        !endMessageItem ||
        parent.startIndex !== startMessageItem.index ||
        parent.endIndex !== endMessageItem.index
    ) {
        throw new NotFoundError("Parent messages for range not found");
    }

    if (parent.endIndex - parent.startIndex === messageItems.length) {
        throw new DataLossError("Incorrect number of messages loaded");
    }

    if (startMessageItem.payload.type !== "Content") {
        throw new FailedPreconditionError("Message range starts in deleted message");
    }

    if (endMessageItem.payload.type !== "Content") {
        throw new FailedPreconditionError("Message range ends in deleted message");
    }

    if (parent.startVersion > (startMessageItem.payload.contentUpdate?.mappings.length ?? 0)) {
        throw new FailedPreconditionError("Invalid message range start version");
    }

    if (parent.endVersion > (endMessageItem.payload.contentUpdate?.mappings.length ?? 0)) {
        throw new FailedPreconditionError("Invalid message range end version");
    }

    // We don't currently validate `startPos` and `endPos` since if we're using a
    // `startVersion`/`endVersion` from the past then `startPos` and `endPos` may
    // point to a position not in the current content.
    //
    // We could use `contentUpdate.mappings` to get a `startPos` and `endPos`
    // relative to the current version but that doesn't seem worthwhile.
}
