import {Memo, ReactElement, ReactNode, cloneElement} from "react";
import {Spacer} from "~/client/web/design/spacer.js";
import {MessageStreamApprovalSessionNoun} from "~/client/web/messaging/internal/message_stream_view_approvals.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {MessageListMessageShimmer} from "~/client/web/messaging/message_list_message_shimmer.js";
import {MessageView} from "~/client/web/messaging/message_view.js";
import {MessagingTypingIndicators} from "~/client/web/messaging/messaging_typing_indicators.js";
import {OnPutMessageApprovalDecisionsFunction} from "~/client/web/messaging/on_put_message_approval_decisions_function.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {
    JumpMessageState,
    JumpToMessageRangeOptions,
} from "~/client/web/messaging/use_jump_to_message_range.js";
import {
    messageViewMarginY,
    messageViewMinHeightPx,
    messagingTypingIndicatorsMinHeightPx,
    messagingViewMarginBottom,
} from "~/client/web/styles/messaging_shared_styles.js";
import {VirtualizedScrollViewItem} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {MessageModel} from "~/shared/messaging/message_model.js";

/**
 * If you are manually implementing a `<VirtualizedScrollView>` for your
 * `MessageList` (not recommended) then you may call this function to render a
 * `MessageListItem`.
 */
// NOTE(calebmer): Ideally `<PostListView>` would reuse some code with this
// function but `<PostListView>` was written before `<MessagingView>` so it'll take
// some work to migrate.
export function renderMessageListItem<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    spacingScale,
    messageNoun,
    messageStartOfSentenceNoun,
    messages,
    fileAttachmentTarget,
    groupKey,
    index,
    item,
    randomSeedForShimmer,
    messageEditing,
    jumpState,
    onJumpToMessageRange,
    onReplyToMessage,
    onDeleteMessage,
    getMessageUrl,
    onSetMessageReaction,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
    onPutMessageApprovalDecisions,
    approvalSessionNoun,
    roomDisplayedCreatedTime,
    shouldAddMarginTop = index === 0,
    shouldAddMarginBottom = false,
    /**
     * Visual breaks (e.g. task activity between comments) that should prevent
     * avatar/name merging even when the adjacent messages would otherwise merge.
     */
    shouldSeparateFromPreviousMessage = false,
    shouldSeparateFromNextMessage = false,
    isReadOnly,
    render: customRender,
}: {
    spacingScale: SpacingScale;
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    messages: MessageList<Message>;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    groupKey: string | null;
    index: number;
    item: MessageListItem<Message>;
    randomSeedForShimmer: string;
    messageEditing: MessageEditing<RoomKey>;
    jumpState: JumpMessageState | null;
    onJumpToMessageRange: Memo<(options: JumpToMessageRangeOptions<RoomKey>) => void>;
    onReplyToMessage: (message: Message) => void;
    onDeleteMessage: (message: Message) => Promise<void>;
    getMessageUrl: (messageIndex: number) => URL;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>>;
    onPutMessageApprovalDecisions?: Memo<OnPutMessageApprovalDecisionsFunction<RoomKey>>;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    roomDisplayedCreatedTime?: Date | undefined;
    shouldAddMarginTop?: boolean | Spacing;
    shouldAddMarginBottom?: boolean | string;
    shouldSeparateFromPreviousMessage?: boolean;
    shouldSeparateFromNextMessage?: boolean;
    isReadOnly?: boolean;
    render?: (node: ReactNode) => ReactElement;
}): VirtualizedScrollViewItem & {renderAdditionalItemIndexes?: readonly []} {
    switch (item.type) {
        case "Loaded":
        case "Unloaded":
        case "Optimistic": {
            const previousItem = index > 0 ? messages.getItem(index - 1) : null;
            const nextItem =
                index < messages.getItemCount() - 1 ? messages.getItem(index + 1) : null;

            const previousMessage =
                !shouldSeparateFromPreviousMessage &&
                (previousItem?.type === "Loaded" || previousItem?.type === "Optimistic")
                    ? previousItem.message
                    : null;
            const nextMessage =
                !shouldSeparateFromNextMessage &&
                (nextItem?.type === "Loaded" || nextItem?.type === "Optimistic")
                    ? nextItem.message
                    : null;

            const isLastMessage =
                item.messageIndex === messages.getMessageCountIncludingOptimisticMessages() - 1;

            const actuallyRender = (
                disableExpensiveFeaturesDuringScroll: boolean,
            ): ReactElement => {
                return item.type === "Loaded" || item.type === "Optimistic" ? (
                    <MessageView
                        messageNoun={messageNoun}
                        messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                        message={item.message}
                        fileAttachmentTarget={fileAttachmentTarget}
                        isFirstMessage={item.messageIndex === 0}
                        isLastMessage={isLastMessage}
                        previousMessage={previousMessage}
                        nextMessage={nextMessage}
                        messages={messages}
                        messageEditing={messageEditing}
                        jumpState={jumpState}
                        onJumpToMessageRange={onJumpToMessageRange}
                        onReplyToMessage={() => {
                            if (item.message.isOptimistic) return;
                            onReplyToMessage(item.message);
                        }}
                        onDeleteMessage={async () => {
                            if (item.message.isOptimistic) return;
                            await onDeleteMessage(item.message);
                        }}
                        onSetMessageReaction={onSetMessageReaction}
                        onDeleteMessageReaction={onDeleteMessageReaction}
                        onUpdateMessagesOptimistically={onUpdateMessagesOptimistically}
                        onPutMessageApprovalDecisions={onPutMessageApprovalDecisions}
                        approvalSessionNoun={approvalSessionNoun}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        getMessageUrl={getMessageUrl}
                        roomDisplayedCreatedTime={roomDisplayedCreatedTime}
                        isReadOnly={isReadOnly}
                    />
                ) : (
                    <MessageListMessageShimmer
                        randomSeed={randomSeedForShimmer}
                        index={item.messageIndex}
                        previousMessage={previousMessage}
                        nextMessage={nextMessage}
                        messages={messages}
                    />
                );
            };

            // It's important to reuse nodes across renders because then React won't try to
            // re-render the component.
            let elementWithExpensiveFeaturesDisabled: ReactElement | null = null;
            let elementWithoutExpensiveFeaturesDisabled: ReactElement | null = null;

            // NOTE(calebmer): This is an inline implementation of
            // `renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll()`.
            // That helper was added after this code and this code has some `customRender`
            // stuff I'm going to leave alone. Ideally this code would use the helper.
            const render = (isScrolling: boolean) => {
                // If we already rendered the node without expensive features disabled, don't
                // render a new version since that will cause a frame drop right at the start of
                // the scroll as React re-renders every message.
                if (elementWithoutExpensiveFeaturesDisabled !== null)
                    return elementWithoutExpensiveFeaturesDisabled;

                if (isScrolling) {
                    elementWithExpensiveFeaturesDisabled ??= actuallyRender(true);
                    return elementWithExpensiveFeaturesDisabled;
                } else {
                    elementWithoutExpensiveFeaturesDisabled ??= actuallyRender(false);
                    return elementWithoutExpensiveFeaturesDisabled;
                }
            };

            return {
                key:
                    typeof groupKey === "string"
                        ? item.type === "Loaded" || item.type === "Optimistic"
                            ? `Message:${groupKey}:${item.messageIndex}`
                            : `UnloadedMessage:${groupKey}:${item.messageIndex}`
                        : item.type === "Loaded" || item.type === "Optimistic"
                          ? `Message:${item.messageIndex}`
                          : `UnloadedMessage:${item.messageIndex}`,
                minHeight: messageViewMinHeightPx[spacingScale],
                zIndex:
                    messageEditing.state.isEditing &&
                    messageEditing.state.messageIndex === item.messageIndex
                        ? "10"
                        : "0",
                withManualLayout: true,
                render: ({
                    ref,
                    shouldRenderWithRelativePositioning,
                    offset,
                    isScrolling,
                    zIndex,
                }) => {
                    if (!customRender) {
                        return (
                            <div
                                ref={ref}
                                style={{
                                    minHeight: messageViewMinHeightPx[spacingScale],
                                    zIndex,
                                    ...(shouldRenderWithRelativePositioning
                                        ? {position: "relative"}
                                        : {
                                              position: "absolute",
                                              top: offset,
                                              left: 0,
                                              right: 0,
                                          }),
                                }}
                            >
                                {shouldAddMarginTop && (
                                    <Spacer
                                        space={
                                            typeof shouldAddMarginTop === "string"
                                                ? shouldAddMarginTop
                                                : messageViewMarginY
                                        }
                                    />
                                )}
                                {render(isScrolling)}
                                {shouldAddMarginBottom && (
                                    <div
                                        style={{
                                            height:
                                                typeof shouldAddMarginBottom === "string"
                                                    ? shouldAddMarginBottom
                                                    : messagingViewMarginBottom,
                                        }}
                                    />
                                )}
                            </div>
                        );
                    } else {
                        const node = customRender(
                            <>
                                {shouldAddMarginTop && (
                                    <Spacer
                                        space={
                                            typeof shouldAddMarginTop === "string"
                                                ? shouldAddMarginTop
                                                : messageViewMarginY
                                        }
                                    />
                                )}
                                {render(isScrolling)}
                                {shouldAddMarginBottom && (
                                    <div
                                        style={{
                                            height:
                                                typeof shouldAddMarginBottom === "string"
                                                    ? shouldAddMarginBottom
                                                    : messagingViewMarginBottom,
                                        }}
                                    />
                                )}
                            </>,
                        );

                        return cloneElement(node as any, {
                            ref,
                            style: {
                                ...(node as any).props.style,
                                minHeight: messageViewMinHeightPx,
                                zIndex,
                                ...(shouldRenderWithRelativePositioning
                                    ? {position: "relative"}
                                    : {
                                          position: "absolute",
                                          top: offset,
                                          left: 0,
                                          right: 0,
                                      }),
                            },
                        });
                    }
                },
            };
        }
        case "TypingIndicators": {
            const node = (
                <MessagingTypingIndicators
                    typingStateByConnectionId={item.typingStateByConnectionId}
                    shouldAddMarginTop={shouldAddMarginTop}
                    shouldAddMarginBottom={shouldAddMarginBottom}
                />
            );

            return {
                key:
                    typeof groupKey === "string"
                        ? `TypingIndicators:${groupKey}`
                        : "TypingIndicators",
                minHeight: messagingTypingIndicatorsMinHeightPx[spacingScale],
                node: customRender ? customRender(node) : node,
            };
        }
        default:
            throw exhaustive(item);
    }
}

export function getMessageListItemKey<Message extends MessageModel>(
    item: MessageListItem<Message>,
    groupKey: string | null,
) {
    switch (item.type) {
        case "Loaded":
        case "Optimistic":
            return typeof groupKey === "string"
                ? `Message:${groupKey}:${item.messageIndex}`
                : `Message:${item.messageIndex}`;
        case "Unloaded":
            return typeof groupKey === "string"
                ? `UnloadedMessage:${groupKey}:${item.messageIndex}`
                : `UnloadedMessage:${item.messageIndex}`;
        case "TypingIndicators":
            return typeof groupKey === "string"
                ? `TypingIndicators:${groupKey}`
                : "TypingIndicators";

        default:
            throw exhaustive(item);
    }
}
