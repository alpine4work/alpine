import classNames from "classnames";
import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {timeline} from "motion";
import {ArrowArcLeft, ArrowArcRight, SpinnerGap, Trash} from "phosphor-react";
import {
    Fragment,
    Memo,
    MutableRefObject,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentView} from "~/client/content/content_view.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {
    PrettyAbsoluteDate,
    PrettyAbsoluteDateTooltipContent,
} from "~/client/design/pretty_absolute_date.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {formatMessageViewTimestampDividerDate} from "~/client/messaging/format_message_view_timestamp_divider_date.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageViewActions} from "~/client/messaging/internal/message_view_actions.js";
import {
    MessageViewEditor,
    MessageViewEditorRef,
} from "~/client/messaging/internal/message_view_editor.js";
import {shouldDisplayTextAsBigEmojiMessage} from "~/client/messaging/internal/should_display_text_as_big_emoji_message.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {MessageViewTouchLightbox} from "~/client/messaging/message_view_touch_lightbox.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useCanPrimaryInputHover, usePlatform} from "~/client/remix/platform_context.js";
import {getRemPxWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {
    getMessageBubbleMarginLeft,
    messageView2AccountNameFontSize,
    messageView2AccountNameMarginBottom,
    messageView2AvatarOffsetY,
    messageView2AvatarSize,
    messageView2RailGap,
    messageViewActionsWidth,
    messageViewActionsWidthWithoutHoveringPrimaryInput,
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMarginY,
    messageViewMaxWidth,
    messageViewMergedMarginY,
    messageViewParentAvatarSize,
    messageViewReplyPreviewBubbleOpacity,
    messageViewParentFontSize,
    messageViewParentLineHeight,
    messageViewReplyPreviewOpacity,
    messageViewParentScale,
    messageView2AvatarOffsetYRem,
} from "~/client/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    contentViewStyles,
    emojiFontFamily,
    fontSizes,
    messagingStyles,
    spinAnimationClassName,
    sprinkles,
    wiggleAnimation,
    wiggleAnimationDuration,
} from "~/client/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {
    linkClassName,
    paragraphClassName,
    quoteBlockClassName,
} from "~/shared/content/content_styles.js";
import {easeOutExpo, parseCubicBezier} from "~/shared/design/core/easing.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {getTruncatedMessageContentForReplyPreview} from "~/client/messaging/get_truncated_message_content_for_reply_preview.js";
import {
    MessageModel,
    MessageModelBase,
    OptimisticMessageModel,
} from "~/shared/messaging/message_model.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/notifications/min_message_view_timestamp_divider_elapsed_minutes.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {usePress} from "@react-aria/interactions";
import {ContextMenuActions, useContextMenuActions} from "~/client/design/context_menu.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {MenuAction} from "~/client/design/menu.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {assignInlineVars} from "@vanilla-extract/dynamic";

// NOCOMMIT: Test
//
// - Emoji messages
// - Message editing
// - Deleted messages
// - Message timestamps
// - Message replies

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height
 * divided by the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

const mergeMessageMinuteLimit = 5;

const messageViewTouchReplyIconSize = "5";
const messageViewTouchReplyIconSizeRem = parseRemLength(messageViewTouchReplyIconSize);

const messageViewTouchReplyIconStartOffset = "1.5";
const messageViewTouchReplyIconStartOffsetRem = parseRemLength(
    messageViewTouchReplyIconStartOffset,
);

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

/**
 * Should two messages merge together?
 */
function shouldMergeMessages(message1: MessageModelBase, message2: MessageModelBase): boolean {
    return (
        message1.author.id === message2.author.id &&
        Math.abs(differenceInMinutes(message1.createdTime, message2.createdTime)) <
            mergeMessageMinuteLimit &&
        (message2.payload.type !== "Content" || message2.payload.parentMessageIndex === null)
    );
}

export function MessageView<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    message,
    isFirstMessage,
    previousMessage,
    nextMessage,
    messages,
    messageEditing,
    disableExpensiveFeaturesDuringScroll,
    shouldHighlightRef,
    onJumpToMessage,
    onReplyToMessage: onReplyToMessageProp,
    onDeleteMessage,
    getMessageUrl,
    roomDisplayedCreatedTime,
    paddingX = screenPaddingX,
    centeringMarginRight,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    message: Message | OptimisticMessageModel;
    isFirstMessage: boolean;
    previousMessage: MessageModelBase | null;
    nextMessage: MessageModelBase | null;
    messages: MessageList<Message>;
    messageEditing: MessageEditing<RoomKey>;
    disableExpensiveFeaturesDuringScroll: boolean;
    shouldHighlightRef: MutableRefObject<boolean> | null;
    onJumpToMessage: Memo<(message: Message) => void>;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    getMessageUrl: (messageIndex: number) => URL;
    roomDisplayedCreatedTime?: Date;
    paddingX?: Spacing | Memo<{mobile: Spacing; desktop: Spacing}>;
    centeringMarginRight?: Spacing;
}) {
    const platform = usePlatform();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();
    const openContextMenuActions = useContextMenuActions();

    const messageAuthor = useAccountModel(message.author);

    const containerRef = useRef<HTMLDivElement>(null);
    // NOCOMMIT: Attach message ref to better place?
    const messageRef = useRef<HTMLDivElement>(null);
    const touchReplyIconRef = useRef<HTMLDivElement>(null);

    const {
        shouldMergeWithPreviousMessage,
        shouldMergeWithNextMessage,
        shouldShowTimestampBeforeMessage,
    } = useMemo(() => {
        const shouldMergeWithPreviousMessage: boolean =
            previousMessage !== null && shouldMergeMessages(previousMessage, message);

        const shouldMergeWithNextMessage: boolean =
            nextMessage !== null && shouldMergeMessages(message, nextMessage);

        const shouldShowTimestampBeforeMessage: boolean = isFirstMessage
            ? !roomDisplayedCreatedTime ||
              differenceInMinutes(message.createdTime, roomDisplayedCreatedTime) >
                  minMessageViewTimestampDividerElapsedMinutes
            : previousMessage !== null &&
              differenceInMinutes(message.createdTime, previousMessage.createdTime) >
                  minMessageViewTimestampDividerElapsedMinutes;

        return {
            shouldMergeWithPreviousMessage,
            shouldMergeWithNextMessage,
            shouldShowTimestampBeforeMessage,
        };
    }, [isFirstMessage, message, nextMessage, previousMessage, roomDisplayedCreatedTime]);

    let marginBottom: Spacing;

    if (!shouldMergeWithNextMessage) {
        marginBottom = messageViewMarginY;
    } else {
        if (
            message.payload.type === "Content" &&
            message.payload.content.doc.childCount > 0 &&
            nextMessage?.payload.type === "Content" &&
            nextMessage.payload.content.doc.childCount > 0 &&
            (hasStandaloneMarginByContentBlockNodeTypeName[
                message.payload.content.doc.lastChild!.type.name
            ] ||
                hasStandaloneMarginByContentBlockNodeTypeName[
                    nextMessage.payload.content.doc.firstChild!.type.name
                ])
        ) {
            marginBottom = contentStyles.standaloneBlockMargin;
        } else {
            marginBottom = contentStyles.paragraphMargin;
        }
    }

    const parentMessage =
        message.payload.type === "Content" && message.payload.parentMessageIndex !== null
            ? assertExists(
                  messages.getLoadedMessageIfExists(message.payload.parentMessageIndex),
                  "Parent message should have been loaded",
              )
            : null;

    const messageEditingForThisMessage =
        // If we're on a mobile device (with keyboard toolbars) then instead of editing
        // a message inline, we edit it within the sticky `<MessageInput>`.
        platform !== "mobile" &&
        messageEditing.state.isEditing &&
        !message.isOptimistic &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        messageEditing.state.messageIndex === message.index
            ? (messageEditing as MessageEditing<RoomKey> & {state: {isEditing: true}})
            : null;

    const isEditingThisMessage = !!messageEditingForThisMessage;

    const messageEditorRef = useRef<MessageViewEditorRef>(null);
    const returnFocusAfterMessageEditingRef = useRef<(() => void) | null>(null);
    const hasMessageEditingConfirmationDialogRef = useRef(false);

    useEffect(() => {
        // When we finish editing, call the return focus function if there was one on
        // our message editing state.
        {
            const returnFocusAfterEditing = messageEditingForThisMessage
                ? messageEditingForThisMessage.state.returnFocusAfterEditing
                : null;

            if (
                returnFocusAfterMessageEditingRef.current !== null &&
                returnFocusAfterEditing === null
            ) {
                returnFocusAfterMessageEditingRef.current();
            }

            returnFocusAfterMessageEditingRef.current = returnFocusAfterEditing;
        }

        // If a confirmation dialog modal closes and we're still editing then return focus
        // to the message editor.
        {
            const hasConfirmationDialog =
                !!messageEditingForThisMessage &&
                messageEditingForThisMessage.state.confirmationDialog !== null;

            if (
                hasMessageEditingConfirmationDialogRef.current &&
                !hasConfirmationDialog &&
                messageEditingForThisMessage
            ) {
                messageEditorRef.current?.focus();
            }

            hasMessageEditingConfirmationDialogRef.current = hasConfirmationDialog;
        }
    }, [messageEditing.state, messageEditingForThisMessage]);

    // NOCOMMIT
    const [shouldShowOptimisticLoadingIndicator, setShouldShowOptimisticLoadingShimmer] =
        useState(false);

    const shouldShowOptimisticLoadingIndicatorAfterDelay =
        message.isOptimistic && !message.optimisticRequestErrorState.hasError;

    useEffect(() => {
        if (!shouldShowOptimisticLoadingIndicatorAfterDelay) {
            setShouldShowOptimisticLoadingShimmer(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowOptimisticLoadingShimmer(true);
            // Use a longer timeout than `delayLoadingIndicatorLimitMs` since most of the
            // time the optimistic placement is the correct end state.
        }, 1000);

        return () => {
            timeout.clear();
        };
    }, [shouldShowOptimisticLoadingIndicatorAfterDelay]);

    const [shouldHighlight, setShouldHighlight] = useState(false);

    // If the ref we were provided told us to highlight then update our state and
    // clear the ref so we only highlight once for the ref.
    useEffect(() => {
        if (!shouldHighlightRef?.current) return;

        let cleanup: (() => void) | undefined;

        const unschedule = scheduleAfterNavigationAnimation(() => {
            // Wait a bit before highlighting in case this component is immediately
            // unmounted. This will happen if while measuring content the virtualized
            // scroll view thinks this is offscreen before our scroll anchoring puts it
            // back in place. Arguably this is a bug in the virtualized scroll view.
            const timeout = createTimeout(() => {
                if (!shouldHighlightRef?.current) return;
                shouldHighlightRef.current = false;

                setShouldHighlight(true);
            }, 10);

            cleanup = () => timeout.clear();
        });

        return () => {
            unschedule();
            cleanup?.();
        };
    }, [shouldHighlightRef]);

    useEffect(() => {
        if (!shouldHighlight) return;

        const timeout = createTimeout(() => {
            setShouldHighlight(false);
        }, wiggleAnimationDuration);

        return () => {
            timeout.clear();
        };
    }, [shouldHighlight]);

    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const messageTextForBigEmojiMessage = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        if (
            message.payload.content.doc.marks.length === 0 &&
            message.payload.content.doc.childCount === 1 &&
            message.payload.content.doc.firstChild!.type.name === "paragraph" &&
            message.payload.content.doc.firstChild!.marks.length === 0 &&
            message.payload.content.doc.firstChild!.childCount === 1 &&
            message.payload.content.doc.firstChild!.firstChild!.type.name === "text" &&
            message.payload.content.doc.firstChild!.firstChild!.marks.length === 0
        ) {
            const text = message.payload.content.doc.firstChild!.firstChild!.text!;
            if (shouldDisplayTextAsBigEmojiMessage(text)) {
                return text;
            }
        }
        return null;
    }, [message.payload]);

    // We try to memoize any UI in this component that changes infrequently to
    // speed up React rendering. Because `<MessageView>` renders during scroll
    // animations it's important to keep it fast.
    const contentPayloadNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        // Render the message as a big emoji message if the content is just emojis.
        if (messageTextForBigEmojiMessage) {
            const children = [];

            let lastIndex = 0;
            for (const {index, emoji} of iterateEmojis(messageTextForBigEmojiMessage)) {
                if (lastIndex !== index) {
                    children.push(
                        <Fragment key={lastIndex}>
                            {messageTextForBigEmojiMessage.slice(lastIndex, index)}
                        </Fragment>,
                    );
                }

                children.push(
                    <span key={index} style={{fontFamily: emojiFontFamily}}>
                        {emoji}
                    </span>,
                );

                lastIndex = index + emoji.length;
            }

            if (lastIndex !== messageTextForBigEmojiMessage.length - 1) {
                children.push(
                    <Fragment key={lastIndex}>
                        {messageTextForBigEmojiMessage.slice(lastIndex)}
                    </Fragment>,
                );
            }

            return (
                <div
                    className={sprinkles({
                        fontSize: "600",
                        userSelect: canPrimaryInputHover ? "text" : "none",
                    })}
                >
                    {children}
                    {message.payload.contentUpdatedTime && (
                        <Tooltip
                            placement="bottom"
                            content={
                                <PrettyAbsoluteDateTooltipContent
                                    date={message.payload.contentUpdatedTime}
                                />
                            }
                        >
                            <span
                                className={contentViewStyles.updatedNoteClassName}
                                style={{paddingLeft: spacing["1"]}}
                            >
                                {" "}
                                (updated)
                            </span>
                        </Tooltip>
                    )}
                </div>
            );
        }

        return (
            <ContentView
                isBackgroundColorGrey5={true}
                content={message.payload.content}
                contentUpdatedTime={message.payload.contentUpdatedTime}
                withUserSelectNone={!canPrimaryInputHover}
            />
        );
    }, [canPrimaryInputHover, message.payload, messageTextForBigEmojiMessage]);

    const deletedPayloadNode = useMemo(() => {
        if (message.payload.type !== "Deleted") return null;

        return (
            <Tooltip
                placement="bottom"
                content={
                    <>
                        Deleted{" "}
                        <PrettyAbsoluteDateTooltipContent
                            date={message.payload.deletedTime}
                            withoutWeekday
                        />
                    </>
                }
            >
                <div
                    className={sprinkles({
                        display: "inline",
                        color: "grey-60",
                        fontSize: "100",
                        userSelect: "text",
                    })}
                    style={{lineHeight: contentStyles.paragraphFontSize.lineHeight}}
                >
                    <Trash
                        size={spacing["4"]}
                        style={{
                            display: "inline",
                            verticalAlign: "top",
                            position: "relative",
                            // Optically align icon with text.
                            top: "0.1875rem",
                        }}
                    />{" "}
                    Deleted {messageNoun}
                </div>
            </Tooltip>
        );
    }, [message.payload, messageNoun]);

    const parentMessageNode = useMemo(() => {
        if (!parentMessage) return null;

        return (
            <MessageViewParent
                messageNoun={messageNoun}
                parentMessage={parentMessage}
                onJumpToMessage={onJumpToMessage}
            />
        );
    }, [messageNoun, onJumpToMessage, parentMessage]);

    const timestampDividerNode = useMemo(() => {
        if (!shouldShowTimestampBeforeMessage) return null;

        const formattedDate = formatMessageViewTimestampDividerDate(message.createdTime, {
            currentTime,
            locale,
            timeZone,
        });

        return (
            <div
                className={sprinkles({
                    paddingTop: !isFirstMessage ? "12" : undefined,
                    paddingBottom: "5",
                    display: "flex",
                    justifyContent: "center",
                    fontSize: "50",
                    fontStyle: "truncate",
                    color: "grey-50",
                    // The timestamp divider should be centered. For UI like `<PostListView>` we
                    // show a guideline to help the user see that comments are a child of the post.
                    // This guideline offsets messages to the left. To center timestamp dividers
                    // with the post we need to apply some extra margin on the right to balance
                    // things out.
                    paddingRight: centeringMarginRight,
                })}
            >
                {formattedDate}
            </div>
        );
    }, [
        centeringMarginRight,
        currentTime,
        isFirstMessage,
        locale,
        message.createdTime,
        shouldShowTimestampBeforeMessage,
        timeZone,
    ]);

    const id = useId();
    const isContextMenuOpenForThisMessage = useMemo(
        () =>
            openContextMenuActions?.some(subActions =>
                subActions.some(action => !action.withCustomLayout && action.key === id),
            ),
        [openContextMenuActions, id],
    );

    // Some edge cases to test:
    //
    // - Select multiple messages (should only show "Copy")
    // - Select text in one message then right click the parent message of another
    //   (should show right click actions for the attached message)
    const getContextMenuActions = useEvent((event: MouseEvent) => {
        const containerElement = assertExists(containerRef.current);
        const selection = window.getSelection();

        // If the `contextmenu` event target is outside of the selection then empty out
        // the selection. The user is right-clicking this message, not the selection.
        // This mirrors the behavior of `<ContextMenuContextProvider>` which calls
        // `selection?.empty()` as well if `event.target` is outside the selection.
        if (event.target instanceof Node && selection?.containsNode(event.target, true)) {
            // If the selection spans multiple messages then we don't want to add context
            // menu actions for a single message. Instead we should only show "Copy".
            if (
                !containerElement.contains(selection.anchorNode) ||
                !containerElement.contains(selection.focusNode)
            ) {
                return [];
            }
        } else {
            selection?.empty();
        }

        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        if (message.payload.type === "Content") {
            contextMenuActions.push([
                {
                    label: "Reply",
                    icon: <ArrowArcRight />,
                    iconPlacement: "end",
                    onPress: () => {
                        // If we're currently editing a message on mobile then cancel editing when
                        // trying to reply to a message. Otherwise `<MessageInput>` will override the
                        // reply state with editing state.
                        if (platform === "mobile" && messageEditing.state.isEditing) {
                            messageEditing.dispatch({type: "CancelEditing"});
                        }

                        onReplyToMessageProp();
                    },
                },
            ]);
        }

        contextMenuActions.push([
            {
                key: id,
                label: "Copy link",
                isDisabled: message.isOptimistic,
                pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
                onPress: async () => {
                    if (message.isOptimistic) return;
                    await writeTextToClipboard(getMessageUrl(message.index).toString());
                },
            },
        ]);

        if (message.payload.type === "Content") {
            contextMenuActions.push([
                {
                    label: "Edit",
                    onPress: () => {
                        // NOCOMMIT
                    },
                },
                {
                    label: "Delete",
                    onPress: () => {
                        setShowDeleteConfirmationDialog(true);
                    },
                },
            ]);
        }

        return contextMenuActions;
    });

    // IMPORTANT(calebmer): Be careful about what you put in this component!
    // `<MessageView>` needs to render fast for us to get good FPS when scrolling
    // through messages. We've directly observed slow hook implementations or too
    // many sub-components slowing down FPS. (Reason why we don't allow `<Box>` in
    // this file.) Before adding new logic to this render function, consider
    // whether you could add it to a child component. Or inline some of the logic.

    return (
        <>
            {timestampDividerNode}
            <ContextMenuActions
                actions={getContextMenuActions}
                // Merge the text copy action into the "Copy link" section.
                mergeReadonlyCopyAction={(actionSections, copyTextAction) => {
                    const copyLinkActionSectionIndex = actionSections.findIndex(actionSection =>
                        actionSection.some(
                            action => !action.withCustomLayout && action.label === "Copy link",
                        ),
                    );

                    if (copyLinkActionSectionIndex === -1) {
                        return [[copyTextAction], ...actionSections];
                    }

                    const newActionSections = [...actionSections];

                    newActionSections[copyLinkActionSectionIndex] = [
                        {...copyTextAction, label: "Copy text"},
                        ...newActionSections[copyLinkActionSectionIndex]!,
                    ];

                    return newActionSections;
                }}
            >
                <div
                    ref={containerRef}
                    className={sprinkles({
                        width: "full",
                        maxWidth: contentStyles.contentMaxWidth,
                        marginX: "auto",
                        paddingX,
                        paddingBottom: marginBottom,
                    })}
                    style={{
                        animation: shouldHighlight ? wiggleAnimation : undefined,
                    }}
                    data-testid={
                        process.env.NODE_ENV !== "production"
                            ? `MessageView:${
                                  message.isOptimistic
                                      ? `optimistic:${message.optimisticId}`
                                      : `${message.getRoomKey()}:${message.index}`
                              }`
                            : undefined
                    }
                >
                    {parentMessageNode}
                    <div
                        className={sprinkles({
                            marginX: "center",
                            position: "relative",
                            zIndex: "0",
                            display: "flex",
                            gap: messageView2RailGap,
                        })}
                    >
                        {useMemo(
                            () => (
                                <div
                                    className={sprinkles({
                                        flexShrink: "0",
                                        width: messageView2AvatarSize,
                                    })}
                                >
                                    {!shouldMergeWithPreviousMessage && (
                                        <div
                                            className={sprinkles({position: "relative"})}
                                            style={{top: messageView2AvatarOffsetY}}
                                        >
                                            <AccountAvatar
                                                account={messageAuthor}
                                                size={messageView2AvatarSize}
                                            />
                                        </div>
                                    )}
                                </div>
                            ),
                            [messageAuthor, shouldMergeWithPreviousMessage],
                        )}
                        <div
                            className={sprinkles({flexGrow: "1"})}
                            style={{
                                // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                // have `min-width: auto` which extends with content.
                                // https://stackoverflow.com/a/66689926/1568890
                                minWidth: 0,
                                ...(isContextMenuOpenForThisMessage
                                    ? assignInlineVars({
                                          [backgroundColorVar]: colorSchemeVars["grey-5"],
                                      })
                                    : null),
                            }}
                        >
                            {!shouldMergeWithPreviousMessage && (
                                <div
                                    className={sprinkles({
                                        fontSize: messageView2AccountNameFontSize,
                                        fontStyle: "truncate",
                                        paddingBottom: messageView2AccountNameMarginBottom,
                                        color: "grey-60",
                                    })}
                                >
                                    {messageAuthor.name}
                                </div>
                            )}
                            {/* NOCOMMIT: {parentMessageNode} */}
                            {message.payload.type === "Content" ? (
                                !messageEditingForThisMessage ? (
                                    /* NOCOMMIT: {showTouchReplyIcon && (
                                    <div
                                        ref={touchReplyIconRef}
                                        className={sprinkles({
                                            position: "absolute",
                                            left: `-${messageViewTouchReplyIconStartOffset}`,
                                            width: messageViewTouchReplyIconSize,
                                            height: messageViewTouchReplyIconSize,
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "center",
                                            color: "grey-70",
                                            backgroundColor: "grey-5",
                                            borderRadius: "full",
                                            pointerEvents: "none",
                                            // Start at opacity 0 and our animation will make it visible.
                                            opacity: "0",
                                        })}
                                        style={{
                                            top: `calc(50% - ${spacing["2.5"]})`,
                                        }}
                                    >
                                        <ArrowArcLeft size={spacing["3"]} />
                                    </div>
                                )} */
                                    contentPayloadNode
                                ) : (
                                    /* NOCOMMIT: <div
                                    className={sprinkles({
                                        alignSelf: "center",
                                        paddingLeft: "3",
                                        pointerEvents: "auto",
                                    })}
                                >
                                    <div
                                        className={sprinkles({
                                            width: canPrimaryInputHover
                                                ? messageViewActionsWidth
                                                : messageViewActionsWidthWithoutHoveringPrimaryInput,
                                            position: "relative",
                                            zIndex: "20",
                                        })}
                                    >
                                        {message.isOptimistic &&
                                        message.optimisticRequestErrorState.hasError ? (
                                            <div>
                                                <IconButton
                                                    // NOTE(calebmer): I think we can use "click" in copy here since the
                                                    // description is part of a tooltip which is fundamentally a mouse/pointer
                                                    // thing. On mobile we need to pop open a modal or alert or something.
                                                    description={`Couldn’t create ${messageNoun}. Click to try again`}
                                                    size="sm"
                                                    onPress={
                                                        message.optimisticRequestErrorState.retry
                                                    }
                                                >
                                                    <ErrorIcon />
                                                </IconButton>
                                            </div>
                                        ) : shouldShowOptimisticLoadingIndicator ? (
                                            <div>
                                                <SpinnerGap
                                                    className={spinAnimationClassName}
                                                    size={spacing["4"]}
                                                />
                                            </div>
                                        ) : (
                                            // If the primary input device can't hover, improve performance by not
                                            // rendering message view actions.
                                            canPrimaryInputHover &&
                                            !message.isOptimistic &&
                                            !disableExpensiveFeaturesDuringScroll &&
                                            !shouldHighlight && (
                                                <MessageViewActions
                                                    messageNoun={messageNoun}
                                                    message={message}
                                                    messagePayload={message.payload}
                                                    messageEditing={messageEditing}
                                                    isHovered={isHovered}
                                                    onReplyToMessage={onReplyToMessage}
                                                    onShowDeleteConfirmationDialog={() =>
                                                        setShowDeleteConfirmationDialog(true)
                                                    }
                                                    getMessageUrl={getMessageUrl}
                                                />
                                            )
                                        )}
                                    </div>
                                </div> */
                                    <MessageViewEditor
                                        ref={messageEditorRef}
                                        messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                        shouldMergeWithPreviousMessage={
                                            shouldMergeWithPreviousMessage
                                        }
                                        shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                                        messageEditing={messageEditing}
                                    />
                                )
                            ) : (
                                deletedPayloadNode
                            )}
                        </div>
                        {/* NOCOMMIT: {platform !== "mobile" &&
                        !message.isOptimistic &&
                        message.payload.type === "Content" &&
                        !disableExpensiveFeaturesDuringScroll && (
                            <MessageViewActions
                                messageNoun={messageNoun}
                                message={message}
                                messagePayload={message.payload}
                                messageEditing={messageEditing}
                                isHovered={isHovered}
                                onReplyToMessage={onReplyToMessage}
                                onShowDeleteConfirmationDialog={() =>
                                    setShowDeleteConfirmationDialog(true)
                                }
                                getMessageUrl={getMessageUrl}
                            />
                        )} */}
                        {isContextMenuOpenForThisMessage && (
                            <div
                                className={sprinkles({
                                    position: "absolute",
                                    top: "-0.5",
                                    height: "full",
                                    left: "-1",
                                    right: "-1",
                                    zIndex: "-10",
                                    backgroundColor: "grey-5",
                                    borderRadius: "1",
                                })}
                                style={{
                                    height: `calc(100% + ${spacing["1"]})`,
                                    // If this is one line of text then the background should extend below
                                    // the avatar.
                                    minHeight: !shouldMergeWithPreviousMessage
                                        ? addRemLengths(
                                              fontSizes[messageView2AccountNameFontSize].lineHeight,
                                              messageView2AccountNameMarginBottom,
                                              contentStyles.paragraphFontSize.lineHeight,
                                              "2",
                                          )
                                        : undefined,
                                }}
                            />
                        )}
                    </div>
                </div>
            </ContextMenuActions>
            {showDeleteConfirmationDialog && (
                <MessageDeleteConfirmationDialog
                    messageNoun={messageNoun}
                    onClose={() => setShowDeleteConfirmationDialog(false)}
                    onDeleteMessage={onDeleteMessage}
                />
            )}
        </>
    );
}

function MessageViewParent<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun,
    parentMessage,
    onJumpToMessage,
}: {
    messageNoun: string;
    parentMessage: Message;
    onJumpToMessage: Memo<(message: Message) => void>;
}) {
    // NOCOMMIT:
    //
    // // Remove some vertical padding from the parent message to move it closer to a
    // // big emoji message which doesn't render in a bubble.
    // if (!messageTextForBigEmojiMessage) height = addRemLengths(height, spacing["1.5"]);

    const truncatedContent = getTruncatedMessageContentForReplyPreview({
        message: parentMessage,
        messageNoun,
    });

    const avatarSizeRem = parseRemLength(messageView2AvatarSize);
    const parentOffsetRem = parseRemLength(messageView2RailGap) / 2;
    const parentAvatarSizeRem = parseRemLength(messageViewParentAvatarSize);
    const parentAvatarOffsetYRem =
        (parseRemLength(messageViewParentAvatarSize) -
            parseRemLength(fontSizes[messageViewParentFontSize].lineHeight)) /
        -2;

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            onJumpToMessage(parentMessage);
        },
    });

    return (
        <FocusRing offset="1" insetX="0.5" insetBottom="0.5">
            <div
                {...pressProps}
                // This is a simulated link. When the user clicks on it our code navigates us
                // to the right message instead of relying on browser URL navigation.
                //
                // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                role="link"
                tabIndex={0}
                className={sprinkles({
                    position: "relative",
                    zIndex: "10",
                    display: "flex",
                    gap: "1.5",
                    width: "full",
                    marginTop: "1",
                    // Intentionally using `paragraphMargin` instead of `standaloneBlockMargin`
                    // since `standaloneBlockMargin` is too much margin for one line responses.
                    marginBottom: contentStyles.paragraphMargin,
                    // We don't use a pointer cursor for buttons in our product because buttons
                    // they clearly appear clickable. We call this a strong affordance. A reply
                    // preview is clickable and gives some affordance (different color) but it's a
                    // weak affordance. So we use a pointer to make this element unambiguously
                    // clickable.
                    //
                    // Also, this element is semantically a link which the pointer cursor was
                    // originally designed for.
                    //
                    // See: https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "pointer",
                })}
                style={{
                    marginLeft: `${avatarSizeRem + parentOffsetRem}rem`,
                }}
            >
                <div
                    className={classNames(
                        // We render the border left/top color as a white with some opacity (which when
                        // blended results in `grey-5`) so that when we render the context menu (right
                        // click) `grey-5` background the border is rendered on top of the background
                        // color.
                        messagingStyles.parentMessageConnectorClassName,
                        sprinkles({
                            position: "absolute",
                            borderLeftWidth: "thick",
                            borderTopWidth: "thick",
                            borderTopLeftRadius: "2.5",
                        }),
                    )}
                    style={{
                        top: `calc(${parentAvatarOffsetYRem + parentAvatarSizeRem / 2}rem - 1px)`,
                        bottom: `calc(-${
                            contentStyles.paragraphMarginRem + messageView2AvatarOffsetYRem
                        }rem + 2px)`,
                        left: `calc(-${avatarSizeRem / 2 + parentOffsetRem}rem - 1px)`,
                        width: `calc(${avatarSizeRem / 2 + parentOffsetRem}rem - 2px)`,
                    }}
                />
                <div
                    className={sprinkles({
                        flexShrink: "0",
                        position: "relative",
                        opacity: isPressed ? "60" : "100",
                    })}
                    style={{top: `${parentAvatarOffsetYRem}rem`}}
                >
                    <AccountAvatar
                        size={messageViewParentAvatarSize}
                        account={parentMessage.author}
                    />
                </div>
                <div
                    className={sprinkles({
                        flexGrow: "1",
                        overflow: "hidden",
                        color: "grey-80",
                        fontSize: messageViewParentFontSize,
                        fontStyle: "normal",
                        opacity: isPressed ? "60" : "100",
                    })}
                    style={{
                        minHeight: messageViewParentLineHeight,
                        lineHeight: messageViewParentLineHeight,
                        // Allow contextual alternate glyphs in regular text content.
                        fontFeatureSettings: '"calt" on',
                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        lineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                    }}
                >
                    <AccountShortName account={parentMessage.author} />: {truncatedContent}
                </div>
            </div>
        </FocusRing>
    );
}

// True for all the block nodes that get standalone block margin in
// `content.css.ts` vs paragraph margin.
const hasStandaloneMarginByContentBlockNodeTypeName: {[key: string]: boolean} = cast<{
    [Key in ContentBlockNodeTypeName]: boolean;
}>({
    paragraph: false,
    unorderedListItem: false,
    orderedListItem: false,
    checkListItem: false,
    heading: false,
    divider: false,
    fileFloat: false,
    quoteBlock: true,
    codeBlock: true,
    fileRow: true,
    table: true,
});
