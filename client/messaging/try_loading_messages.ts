import {MessageList} from "~/client/messaging/message_list.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {messageViewMinHeightPx} from "~/client/styles/messaging_shared_styles.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MessageModel} from "~/shared/messaging/message_model.js";

/**
 * Helper function for loading messages in a given range for a messaging view.
 * Used by the core `<MessagingView>` component and other components which
 * embed messages like `<PostsView>`.
 *
 * The `range` is designed to be a `<VirtualizedScrollView>`s rendered range.
 */
export function tryLoadingMessages<
    Message extends MessageModel,
    Result extends {
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    },
>({
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
    }) => Promise<Result>;
    loadFromEnd: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<Result>;
}):
    | {
          isLoading: false;
      }
    | {
          isLoading: true;
          wasJump: boolean;
          promise: Promise<Result>;
      } {
    range = messages.getMessagesRange(range);
    if (!range) return {isLoading: false};

    const startMessage = messages.getItem(range.startIndex);
    const endMessage = messages.getItem(range.endIndex);

    const spacingScale = getSpacingScaleWithoutListening();
    const virtualizationWindowHeightPx = getVirtualizationWindowHeight(viewHeight);

    // Load enough items to fill the virtualization window once. This gives the
    // user some space to scroll and read before we need to load more messages.
    //
    // If the user did a jump scroll then we load 50% more messages so we have some
    // buffer above and below the virtualization window.
    const limit = Math.max(
        20,
        Math.ceil(virtualizationWindowHeightPx / messageViewMinHeightPx[spacingScale]),
    );

    // Everything rendered is loaded. Yay! Proceed if we need to load some data.
    if (startMessage.type !== "Unloaded" && endMessage.type !== "Unloaded") {
        const afterMessageIndexInclusive = messages.getFirstUnloadedMessageIndexAfterIfExists(
            range.startIndex,
        );
        if (afterMessageIndexInclusive === null || range.endIndex <= afterMessageIndexInclusive) {
            return {isLoading: false};
        }

        const beforeMessageIndexInclusive = messages.getLastUnloadedMessageIndexBeforeIfExists(
            range.endIndex,
        );

        // We know `afterMessageIndexInclusive` is an unloaded message index before
        // `range.endIndex` (as checked by the condition above) so we should at least
        // get that.
        assert(beforeMessageIndexInclusive !== null);

        return {
            isLoading: true,
            wasJump: false,
            promise: loadFromStart({
                afterMessageIndex: afterMessageIndexInclusive - 1,
                beforeMessageIndex: beforeMessageIndexInclusive + 1,
                limit,
            }),
        };
    }

    const jumpLimit = Math.max(
        20,
        Math.ceil((virtualizationWindowHeightPx * 1.5) / messageViewMinHeightPx[spacingScale]),
    );

    if (endMessage.type === "Unloaded" && startMessage.type !== "Unloaded") {
        const afterMessageIndexInclusive = messages.getFirstUnloadedMessageIndexAfterIfExists(
            range.startIndex,
        );

        // We know `endMessage` is unloaded therefore there is at least that one
        // unloaded index before our start index.
        assert(afterMessageIndexInclusive !== null);

        const maxBeforeMessageIndexInclusive = afterMessageIndexInclusive + limit;

        const beforeMessageIndexInclusive = messages.getFirstUnloadedMessageIndexAfterIfExists(
            maxBeforeMessageIndexInclusive + 1,
        );

        return {
            isLoading: true,
            wasJump: false,
            promise: loadFromStart({
                afterMessageIndex: afterMessageIndexInclusive - 1,
                beforeMessageIndex:
                    beforeMessageIndexInclusive !== null &&
                    beforeMessageIndexInclusive < maxBeforeMessageIndexInclusive
                        ? beforeMessageIndexInclusive + 1
                        : null,
                limit,
            }),
        };
    }

    if (startMessage.type === "Unloaded" && endMessage.type !== "Unloaded") {
        const beforeMessageIndexInclusive = messages.getLastUnloadedMessageIndexBeforeIfExists(
            range.endIndex,
        );

        // We know `startMessage` is unloaded therefore there is at least that one
        // unloaded index before our end index.
        assert(beforeMessageIndexInclusive !== null);

        const minBeforeMessageIndexInclusive = beforeMessageIndexInclusive - limit;

        const afterMessageIndexInclusive = messages.getLastUnloadedMessageIndexBeforeIfExists(
            minBeforeMessageIndexInclusive - 1,
        );

        return {
            isLoading: true,
            wasJump: false,
            promise: loadFromEnd({
                afterMessageIndex:
                    afterMessageIndexInclusive !== null &&
                    afterMessageIndexInclusive > minBeforeMessageIndexInclusive
                        ? afterMessageIndexInclusive - 1
                        : null,
                beforeMessageIndex: beforeMessageIndexInclusive + 1,
                limit,
            }),
        };
    }

    // If neither of the messages in our rendered range are loaded then this is a
    // jump scroll. During a jump scroll we take advantage of the fact that message
    // `id`s are mostly dense to pick a message `id` at roughly the same percentage
    // the user has scrolled. We load data in at that point and scroll it
    // into view.
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
