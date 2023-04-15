import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {MessageList} from "~/client/messaging/message_list";
import {messageViewMinHeight} from "~/client/messaging/message_view";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {MessageModel} from "~/shared/models/message_model";

/**
 * Helper function for loading messages in a given range for a messaging view.
 * Used by the core `<MessagingView>` component and other components which
 * embed messages like `<PostsView>`.
 *
 * The `range` is designed to be a `<VirtualizedScrollView>`s rendered range.
 */
export function tryLoadingMessages<Message extends MessageModel>({
    viewHeight,
    messages,
    range,
    loadFromStart,
    loadFromEnd,
}: {
    viewHeight: number;
    messages: MessageList<Message>;
    range: {startIndex: number; endIndex: number} | null;
    loadFromStart: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }>;
    loadFromEnd: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }>;
}):
    | {
          isLoading: false;
      }
    | {
          isLoading: true;
          wasJump: boolean;
          promise: Promise<{
              messageCount: number;
              messages: ReadonlyArray<Message>;
              otherReferencedMessages: ReadonlyArray<Message>;
          }>;
      } {
    range = messages.getMessagesRange(range);
    if (!range) return {isLoading: false};

    const remPx = getRemPxWithoutListening();

    const startMessage = messages.getItem(range.startIndex);
    const endMessage = messages.getItem(range.endIndex);

    const firstLoadedMessage = messages.getFirstLoadedMessageAfterIfExists(range.startIndex - 1);
    const hasLoadedMessage = firstLoadedMessage && firstLoadedMessage.index <= range.endIndex;

    // Everything rendered is loaded. Yay! Proceed if we need to load some data.
    //
    // TODO(calebmer): If there are some unloaded messages in the middle of the
    // range we should load those.
    if (startMessage.type !== "Unloaded" && endMessage.type !== "Unloaded")
        return {isLoading: false};

    // Load enough items to fill the virtualization window once. This gives the
    // user some space to scroll and read before we need to load more messages.
    //
    // If the user did a jump scroll then we load 50% more messages so we have some
    // buffer above and below the virtualization window.
    const limit = Math.max(
        20,
        Math.ceil(
            getVirtualizationWindowHeight(viewHeight) /
                convertRemLengthToPx(messageViewMinHeight, remPx),
        ),
    );
    const jumpLimit = Math.max(
        20,
        Math.ceil(
            (getVirtualizationWindowHeight(viewHeight) * 1.5) /
                convertRemLengthToPx(messageViewMinHeight, remPx),
        ),
    );

    if (endMessage.type === "Unloaded" && hasLoadedMessage) {
        const afterMessageIndex =
            messages.getLastLoadedMessageBeforeIfExists(range.endIndex)?.index ?? null;

        const beforeMessageIndex =
            messages.getFirstLoadedMessageAfterIfExists(range.endIndex)?.index ?? null;

        // Always start at the last loaded message in our range. If there is none then
        // maybe optimistic messages are involved?
        if (afterMessageIndex === null) return {isLoading: false};

        return {
            isLoading: true,
            wasJump: false,
            promise: loadFromStart({
                afterMessageIndex,
                beforeMessageIndex,
                limit,
            }),
        };
    }

    if (startMessage.type === "Unloaded" && hasLoadedMessage) {
        const afterMessageIndex =
            messages.getLastLoadedMessageBeforeIfExists(range.startIndex)?.index ?? null;

        const beforeMessageIndex =
            messages.getFirstLoadedMessageAfterIfExists(range.startIndex)?.index ?? null;

        // Always start at the first loaded message in our range. If there is none then
        // maybe optimistic messages are involved?
        if (beforeMessageIndex === null) return {isLoading: false};

        return {
            isLoading: true,
            wasJump: false,
            promise: loadFromEnd({
                afterMessageIndex,
                beforeMessageIndex,
                limit,
            }),
        };
    }

    // If our range has no loaded messages then this is a jump scroll. During a
    // jump scroll we take advantage of the fact that message `id`s are mostly
    // dense to pick a message `id` at roughly the same percentage the user has
    // scrolled. We load data in at that point and scroll it into view.
    assert(!hasLoadedMessage);
    assert(startMessage.type === "Unloaded" && endMessage.type === "Unloaded");

    const messageBeforeUnloadedSegment = messages.getLastLoadedMessageBeforeIfExists(
        range.startIndex,
    );
    const messageAfterUnloadedSegment = messages.getFirstLoadedMessageAfterIfExists(range.endIndex);

    let afterMessageIndex = Math.floor(
        range.startIndex + (range.endIndex - range.startIndex) / 2 - jumpLimit / 2,
    );
    if (messageBeforeUnloadedSegment)
        afterMessageIndex = Math.max(afterMessageIndex, messageBeforeUnloadedSegment.index);

    return {
        isLoading: true,
        wasJump: true,
        promise: loadFromStart({
            afterMessageIndex: afterMessageIndex >= 0 ? afterMessageIndex : null,
            beforeMessageIndex: messageAfterUnloadedSegment?.index ?? null,
            limit: jumpLimit,
        }),
    };
}
