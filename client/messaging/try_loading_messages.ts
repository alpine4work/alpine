import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {MessageList} from "~/client/messaging/message_list";
import {messageViewMinHeight} from "~/client/messaging/message_view";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {Result} from "~/shared/helpers/control/result";
import {MessageInterface} from "~/shared/models/message_interface";

/**
 * Helper function for loading messages in a given range for a messaging view.
 * Used by the core `<MessagingView>` component and other components which
 * embed messages like `<PostsView>`.
 *
 * The `range` is designed to be a `<VirtualizedScrollView>`s rendered range.
 */
export function tryLoadingMessages<Message extends MessageInterface>({
    viewHeight,
    messages,
    range,
    onLoadFromStart,
    onLoadFromEnd,
    onFinishLoadingMessages,
}: {
    viewHeight: number;
    messages: MessageList<Message>;
    range: {startIndex: number; endIndex: number};
    onLoadFromStart: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }>;
    onLoadFromEnd: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }>;
    onFinishLoadingMessages: (
        result: Result<
            {
                messageCount: number;
                messages: ReadonlyArray<Message>;
                otherReferencedMessages: ReadonlyArray<Message>;
            },
            unknown
        >,
    ) => void;
}):
    | {
          isLoading: false;
      }
    | {
          isLoading: true;
          wasJump: boolean;
      } {
    const remPx = getRemPxWithoutListening();

    const startMessage = messages.getMessage(range.startIndex);
    const endMessage = messages.getMessage(range.endIndex);

    // Everything rendered is loaded. Yay! Proceed if we need to load some data.
    //
    // TODO(calebmer): If there are some unloaded messages in the middle of the
    // range we should load those.
    if (startMessage.type !== "Unloaded" && endMessage.type !== "Unloaded")
        return {isLoading: false};

    // The limit of items we will load is two views worth of messages. This gives
    // the user some space to scroll and read before we need to load more messages.
    //
    // If the user did a jump scroll then we will load three views worth of
    // messages.
    const limit = Math.max(
        20,
        Math.ceil((viewHeight * 2) / convertRemLengthToPx(messageViewMinHeight, remPx)),
    );
    const jumpLimitViewCount = 3;
    const jumpLimit = Math.max(
        20,
        Math.ceil(
            (viewHeight * jumpLimitViewCount) / convertRemLengthToPx(messageViewMinHeight, remPx),
        ),
    );

    const loadFromStart = ({
        afterMessageIndex,
        beforeMessageIndex,
        limit,
    }: {
        afterMessageIndex: number;
        beforeMessageIndex: number | null;
        limit: number;
    }) => {
        onLoadFromStart({
            afterMessageIndex,
            beforeMessageIndex,
            limit,
        }).then(
            result => {
                onFinishLoadingMessages({
                    ok: true,
                    value: result,
                });
            },
            error => {
                onFinishLoadingMessages({
                    ok: false,
                    error,
                });
            },
        );
    };

    if (startMessage.type !== "Unloaded" && endMessage.type === "Unloaded") {
        const afterMessageIndex =
            messages.getLastLoadedMessageBefore(range.endIndex)?.index ?? null;

        const beforeMessageIndex =
            messages.getFirstLoadedMessageAfter(range.endIndex)?.index ?? null;

        // Always start at the last loaded message in our range. If there is none then
        // maybe optimistic messages are involved?
        if (afterMessageIndex === null) return {isLoading: false};

        loadFromStart({
            afterMessageIndex,
            beforeMessageIndex,
            limit,
        });
        return {isLoading: true, wasJump: false};
    }

    if (startMessage.type === "Unloaded" && endMessage.type !== "Unloaded") {
        const afterMessageIndex =
            messages.getLastLoadedMessageBefore(range.startIndex)?.index ?? null;

        const beforeMessageIndex =
            messages.getFirstLoadedMessageAfter(range.startIndex)?.index ?? null;

        // Always start at the first loaded message in our range. If there is none then
        // maybe optimistic messages are involved?
        if (beforeMessageIndex === null) return {isLoading: false};

        onLoadFromEnd({
            afterMessageIndex,
            beforeMessageIndex,
            limit,
        }).then(
            result => {
                onFinishLoadingMessages({
                    ok: true,
                    value: result,
                });
            },
            error => {
                onFinishLoadingMessages({
                    ok: false,
                    error,
                });
            },
        );
        return {isLoading: true, wasJump: false};
    }

    // If neither of the messages in our rendered range are loaded then this is a
    // jump scroll. During a jump scroll we take advantage of the fact that message
    // `id`s are mostly dense to pick a message `id` at roughly the same percentage
    // the user has scrolled. We load data in at that point and scroll it
    // into view.
    assert(startMessage.type === "Unloaded" && endMessage.type === "Unloaded");

    const messageBeforeUnloadedSegment = messages.getLastLoadedMessageBefore(range.startIndex);
    const messageAfterUnloadedSegment = messages.getFirstLoadedMessageAfter(range.endIndex);

    let afterMessageIndex =
        range.startIndex + (range.endIndex - range.startIndex) / 2 - jumpLimit / 2;
    if (messageBeforeUnloadedSegment)
        afterMessageIndex = Math.max(afterMessageIndex, messageBeforeUnloadedSegment.index);

    loadFromStart({
        afterMessageIndex,
        beforeMessageIndex: messageAfterUnloadedSegment?.index ?? null,
        limit: jumpLimit,
    });
    return {isLoading: true, wasJump: true};
}
