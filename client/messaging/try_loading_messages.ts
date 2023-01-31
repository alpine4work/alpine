import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {messageViewMinHeight} from "~/client/messaging/message_view";
import {PaginatedMessageList, minMessageId} from "~/client/messaging/paginated_message_list";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
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
    messages: PaginatedMessageList<Message>;
    range: {startIndex: number; endIndex: number};
    onLoadFromStart: (options: {
        limit: number;
        afterMessageId: number | null;
        beforeMessageId: number | null;
    }) => Promise<{
        messages: ReadonlyArray<Message>;
        hasMoreMessagesAfter: boolean;
    }>;
    onLoadFromEnd: (options: {
        limit: number;
        afterMessageId: number | null;
        beforeMessageId: number | null;
    }) => Promise<{
        messages: ReadonlyArray<Message>;
        hasMoreMessagesBefore: boolean;
    }>;
    onFinishLoadingMessages: (
        result: Result<
            {
                updateMessages: (
                    messages: PaginatedMessageList<Message>,
                ) => PaginatedMessageList<Message>;
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
    if (startMessage.isLoaded && endMessage.isLoaded) return {isLoading: false};

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
        afterMessageId,
        beforeMessageId,
        limit,
    }: {
        afterMessageId: number;
        beforeMessageId: number | null;
        limit: number;
    }) => {
        onLoadFromStart({
            afterMessageId,
            beforeMessageId,
            limit,
        }).then(
            result => {
                onFinishLoadingMessages({
                    ok: true,
                    value: {
                        updateMessages: messages =>
                            messages.loadMessagesFromStart({
                                afterMessageId,
                                beforeMessageId,
                                limit,
                                hasMoreMessagesAfter: result.hasMoreMessagesAfter,
                                messages: result.messages,
                            }),
                    },
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

    if (startMessage.isLoaded && !endMessage.isLoaded) {
        const afterMessageId = assertExists(
            messages.getLastLoadedMessageBefore(range.endIndex),
            "Start message is loaded so there should be a loaded message after our end index",
        ).message.id;

        const beforeMessageId =
            messages.getFirstLoadedMessageAfter(range.endIndex)?.message.id ?? null;

        loadFromStart({
            afterMessageId,
            beforeMessageId,
            limit,
        });
        return {isLoading: true, wasJump: false};
    }

    if (!startMessage.isLoaded && endMessage.isLoaded) {
        const afterMessageId =
            messages.getLastLoadedMessageBefore(range.startIndex)?.message.id ?? null;

        const beforeMessageId = assertExists(
            messages.getFirstLoadedMessageAfter(range.startIndex),
            "End message is loaded so there should be a loaded message after our start index",
        ).message.id;

        onLoadFromEnd({
            afterMessageId,
            beforeMessageId,
            limit,
        }).then(
            result => {
                onFinishLoadingMessages({
                    ok: true,
                    value: {
                        updateMessages: messages =>
                            messages.loadMessagesFromEnd({
                                afterMessageId,
                                beforeMessageId,
                                limit,
                                hasMoreMessagesBefore: result.hasMoreMessagesBefore,
                                messages: result.messages,
                            }),
                    },
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
    assert(!startMessage.isLoaded && !endMessage.isLoaded);

    const messageBeforeUnloadedSegment = messages.getLastLoadedMessageBefore(range.startIndex);
    const messageAfterUnloadedSegment = messages.getFirstLoadedMessageAfter(range.endIndex);

    const unloadedSegmentStartMessageId =
        messageBeforeUnloadedSegment?.message.id ?? minMessageId - 1;
    const unloadedSegmentEndMessageId =
        messageAfterUnloadedSegment?.message.id ??
        Math.max(messages.getEstimatedMessageCount() + 1, unloadedSegmentStartMessageId + 1);

    const unloadedSegmentStartIndex = messageBeforeUnloadedSegment?.index ?? 0;
    const unloadedSegmentEndIndex =
        messageAfterUnloadedSegment?.index ?? messages.getEstimatedMessageCount() - 1;

    const rangeStartFraction =
        (range.startIndex - unloadedSegmentStartIndex) /
        (unloadedSegmentEndIndex - unloadedSegmentStartIndex);

    // Pick a message `id` to start loading data from taking advantage of the fact
    // that messages are mostly dense.
    const afterMessageId = Math.min(
        Math.max(0, unloadedSegmentEndMessageId - jumpLimit),
        Math.round(
            unloadedSegmentStartMessageId +
                (unloadedSegmentEndMessageId - unloadedSegmentStartMessageId) * rangeStartFraction,
        ),
    );

    loadFromStart({
        afterMessageId,
        beforeMessageId: messageAfterUnloadedSegment?.message.id ?? null,
        limit: jumpLimit,
    });
    return {isLoading: true, wasJump: true};
}
