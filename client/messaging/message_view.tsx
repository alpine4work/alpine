import {usePress} from "@react-aria/interactions";
import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {animate} from "motion";
import {ArrowArcLeft, ArrowArcRight, Copy, Link as LinkIcon, Trash} from "phosphor-react";
import {
    Fragment,
    Memo,
    MutableRefObject,
    RefObject,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {
    getAccountRegistry,
    useAccountModel,
    useAccountRegistry,
} from "~/client/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentBlockWidthContextProvider} from "~/client/content/content_block_width.js";
import {ContentView} from "~/client/content/content_view.js";
import {useFileRegistry} from "~/client/content/file_registry_context.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/content/has_standalone_margin_by_content_block_node_type_name.js";
import {getTruncatedMessageContentForReplyPreview} from "~/client/content/messaging/get_truncated_message_content_for_reply_preview.js";
import {MessageViewFiles} from "~/client/content/messaging/message_view_files.js";
import {writeContentToClipboard} from "~/client/content/write_content_to_clipboard.js";
import {ContextMenuActions, useContextMenuActions} from "~/client/design/context_menu.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useOutsideInteraction} from "~/client/design/helpers/use_outside_interaction.js";
import {IconButton} from "~/client/design/icon_button.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {formatMessageViewTimestampDividerDate} from "~/client/messaging/format_message_view_timestamp_divider_date.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageStreamView} from "~/client/messaging/internal/message_stream_view.js";
import {
    MessageViewEditor,
    MessageViewEditorRef,
} from "~/client/messaging/internal/message_view_editor.js";
import {shouldDisplayTextAsBigEmojiMessage} from "~/client/messaging/internal/should_display_text_as_big_emoji_message.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useCanPrimaryInputHover, usePlatform} from "~/client/remix/platform_context.js";
import {getRemPxWithoutListening, useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageViewAccountAvatarSize,
    messageViewAccountNameFontSize,
    messageViewAccountNameHeight,
    messageViewAvatarOffsetYPx,
    messageViewMarginLeft,
    messageViewMarginY,
    messageViewNotMergedOutlineMinHeightPx,
    messageViewOutlineBorderRadius,
    messageViewOutlineMargin,
    messageViewParentAccountAvatarSize,
    messageViewParentAvatarOffsetYRem,
    messageViewParentFontSize,
    messageViewParentLineHeightPx,
    messageViewRailGap,
    messageViewTimestampDividerHeight,
    messageViewTimestampDividerMarginY,
} from "~/client/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    contentViewStyles,
    emojiFontFamily,
    pulseAnimationWithReducedOpacityClassName,
    sprinkles,
    wiggleAnimation,
    wiggleAnimationDuration,
} from "~/client/styles/styles.js";
import {
    AccessPolicy,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {linkClassName} from "~/shared/content/content_styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {easeOutExpo, parseCubicBezier} from "~/shared/design/core/easing.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/notifications/min_message_view_timestamp_divider_elapsed_minutes.js";
import {computeStore} from "~/shared/store/compute_store.js";

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height
 * divided by the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

const mergeMessageMinuteLimit = 5;

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
function shouldMergeMessages<RoomKey extends string>(
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
        (message2.payload.type !== "Content" || message2.payload.parentMessageIndex === null)
    );
}

export function MessageView<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    message,
    fileAttachmentTarget,
    isFirstMessage,
    isLastMessage,
    previousMessage,
    nextMessage,
    messages,
    messageEditing,
    shouldHighlightRef,
    onJumpToMessage,
    onReplyToMessage: onReplyToMessageProp,
    onDeleteMessage,
    getMessageUrl,
    roomDisplayedCreatedTime,
    readOnlyIfAccessPolicyDoesNotHaveCommentAccessLevel,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    message: Message | OptimisticMessageModel;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    isFirstMessage: boolean;
    isLastMessage: boolean;
    previousMessage: Message | OptimisticMessageModel | null;
    nextMessage: Message | OptimisticMessageModel | null;
    messages: MessageList<Message>;
    messageEditing: MessageEditing<RoomKey>;
    disableExpensiveFeaturesDuringScroll: boolean;
    shouldHighlightRef: MutableRefObject<boolean> | null;
    onJumpToMessage: Memo<(message: Message) => void>;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    getMessageUrl: (messageIndex: number) => URL;
    roomDisplayedCreatedTime?: Date;
    readOnlyIfAccessPolicyDoesNotHaveCommentAccessLevel?: AccessPolicy;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const clientInfo = useClientInfo();
    const {currentAccount, space} = useSpaceContext();
    const currentTime = useCurrentTimeRoundedToHour();
    const openContextMenuActions = useContextMenuActions();

    const isReadOnly = useMemo(
        () =>
            readOnlyIfAccessPolicyDoesNotHaveCommentAccessLevel !== undefined &&
            !hasAccessLevel(
                getAccountAccessLevelAssumingSpaceAccess(
                    readOnlyIfAccessPolicyDoesNotHaveCommentAccessLevel,
                    currentAccount?.id,
                ),
                "Comment",
            ),
        [currentAccount?.id, readOnlyIfAccessPolicyDoesNotHaveCommentAccessLevel],
    );

    const messageAuthor = useAccountModel(message.author);

    const containerRef = useRef<HTMLDivElement>(null);
    const parentMessageRef = useRef<HTMLDivElement>(null);
    const accountAvatarContainerRef = useRef<HTMLDivElement>(null);
    const contentContainerRef = useRef<HTMLDivElement>(null);
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

    const marginBottom = useMemo(() => {
        let marginBottom: Spacing;

        if (isLastMessage) {
            marginBottom = messageViewMarginY;
        } else if (!shouldMergeWithNextMessage) {
            marginBottom = messageViewMarginY;
        } else if (
            message.payload.type !== "Content" ||
            message.payload.content.doc.childCount === 0 ||
            nextMessage?.payload.type !== "Content" ||
            nextMessage.payload.content.doc.childCount === 0
        ) {
            marginBottom = contentStyles.paragraphMargin;
        } else {
            const isNextMessageContentEmpty = isContentEmpty(nextMessage.payload.content.doc);

            if (
                message.payload.files.length > 0 &&
                isNextMessageContentEmpty &&
                nextMessage.payload.files.length > 0
            ) {
                marginBottom = contentStyles.fileRowGapWidth;
            } else if (
                hasStandaloneMarginByContentBlockNodeTypeName[
                    message.payload.content.doc.lastChild!.type.name
                ] ||
                hasStandaloneMarginByContentBlockNodeTypeName[
                    nextMessage.payload.content.doc.firstChild!.type.name
                ] ||
                message.payload.files.length > 0 ||
                (isNextMessageContentEmpty && nextMessage.payload.files.length > 0)
            ) {
                marginBottom = contentStyles.standaloneBlockMargin;
            } else {
                marginBottom = contentStyles.paragraphMargin;
            }
        }

        return marginBottom;
    }, [isLastMessage, message.payload, nextMessage, shouldMergeWithNextMessage]);

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

    const shouldShowOptimisticLoadingIndicator = useDelayLoadingIndicator(
        message.isOptimistic === true && !message.optimisticRequestErrorState.hasError,
        // Use a longer timeout than `delayLoadingIndicatorLimitMs` since most of the
        // time the optimistic placement is the correct end state.
        delayLoadingIndicatorLimitMs * 2,
    );

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

    const events = useEvents({
        getClipboardSerializerPrefix: () => {
            if (shouldMergeWithPreviousMessage) return null;

            const authorName = getAccountRegistry(space.id)
                .getAccountStore(message.author)
                .getSnapshot().name;

            return `${authorName}: `;
        },

        onReplyToMessage: () => {
            // If we're currently editing a message on mobile then cancel editing when
            // trying to reply to a message. Otherwise `<MessageInput>` will override the
            // reply state with editing state.
            if (platform === "mobile" && messageEditing.state.isEditing) {
                messageEditing.dispatch({type: "CancelEditing"});
            }

            onReplyToMessageProp();
        },

        // Some edge cases to test:
        //
        // - Select multiple messages (should only show "Copy")
        // - Select text in one message then right click the parent message of another
        //   (should show right click actions for the attached message)
        getContextMenuActions: (event: MouseEvent) => {
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

            // Don't allow replying if the message payload is empty. The UI shouldn't
            // normally allow saving an empty message payload. We allow empty message
            // payloads for messages that have attached files, however. In this special
            // case we don't want to allow the user to reply since the reply message will
            // include no text.
            if (
                !isReadOnly &&
                message.payload.type === "Content" &&
                !isContentEmpty(message.payload.content.doc)
            ) {
                contextMenuActions.push([
                    {
                        label: "Reply",
                        icon: <ArrowArcRight />,
                        iconPlacement: "end",
                        onPress: events.onReplyToMessage,
                    },
                ]);
            }

            contextMenuActions.push([
                {
                    key: id,
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    isDisabled: message.isOptimistic,
                    pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
                    onPress: async () => {
                        if (message.isOptimistic) return;
                        await writeTextToClipboard(getMessageUrl(message.index).toString());
                    },
                },
            ]);

            if (
                !isReadOnly &&
                currentAccount?.id === message.author.id &&
                message.payload.type === "Content" &&
                // Can't update or delete clerical messages.
                !message.payload.clerical
            ) {
                const messagePayload = message.payload;

                const editContextMenuActions: Array<MenuAction> = [];
                contextMenuActions.push(editContextMenuActions);

                // Don't allow editing if the message payload is empty. The UI shouldn't
                // normally allow saving an empty message payload. We allow empty message
                // payloads for messages that have attached files, however. In this special
                // case we don't want to allow the user to add text alongside the files.
                if (!isContentEmpty(messagePayload.content.doc)) {
                    editContextMenuActions.push({
                        label: "Edit",
                        isDisabled: message.isOptimistic,
                        onPress: () => {
                            if (message.isOptimistic) return;

                            messageEditing.dispatch({
                                type: "StartEditing",
                                messageIndex: message.index,
                                messageRoomKey: message.getRoomKey(),
                                messagePayload,
                                platform,
                                returnFocusAfterEditing: null,
                            });
                        },
                    });
                }

                editContextMenuActions.push({
                    label: "Delete",
                    onPress: () => {
                        setShowDeleteConfirmationDialog(true);
                    },
                });
            }

            return contextMenuActions;
        },
    });

    const hasParentMessage = !!parentMessage;

    const [showTouchReplyIcon, setShowTouchReplyIcon] = useState(false);
    const [touchMenuState, setTouchMenuState] = useState<{
        isAnimatingOut: boolean;
        top: number;
        left: number;
    } | null>(null);

    useEffect(() => {
        if (message.payload.type !== "Content") return;

        // Reattach event listeners if the message payload changes. The `messageRef`
        // element may switch between deleted, emoji, and regular messages.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        message.payload;

        if (isEditingThisMessage) return;

        const containerElement = assertExists(containerRef.current);
        const parentMessageElement = parentMessageRef.current;
        const accountAvatarContainerElement = accountAvatarContainerRef.current;
        const contentContainerElement = assertExists(contentContainerRef.current);

        type MessageViewTouchState = {
            gesture: "Reply" | "Other" | null;
            hasReplyGestureActivated: boolean;
            isReplyGestureDisabled: boolean;
            initialClientX: number;
            initialClientY: number;
            longTouchTimeout: Timeout | null;
            finishGesture: (() => Promise<void>) | null;
        };

        let touchState: MessageViewTouchState | null = null;

        const handleTouchStart = (event: TouchEvent) => {
            touchState?.longTouchTimeout?.clear();
            void touchState?.finishGesture?.();
            touchState = null;

            // If the user can hover, let them hover over the message to see message
            // actions. Instead of opening a lightbox on touch which conflicts with text
            // selection.
            if (canPrimaryInputHover) {
                setShowTouchReplyIcon(false);
                return;
            }

            if (event.touches.length > 1) {
                setShowTouchReplyIcon(false);
                return;
            }

            let isReplyGestureDisabled: boolean = isReadOnly;

            if (event.target instanceof HTMLElement) {
                let element: HTMLElement | null = event.target;
                while (element && element.contains(element)) {
                    // If the user is touching a link, then a long press won't open the lightbox.
                    // Instead it will open the link.
                    if (element.classList.contains(linkClassName)) {
                        return;
                    }

                    const {overflowX} = getComputedStyle(element);

                    // If the user is touching a horizontally scrollable element (e.g. a code
                    // block) then disable the reply gesture if it's been scrolled since swiping
                    // horizontally should scroll. Not reply.
                    isReplyGestureDisabled ||=
                        (overflowX === "scroll" ||
                            (overflowX === "auto" && element.scrollWidth > element.clientWidth)) &&
                        element.scrollLeft > 0;

                    element = element.parentElement;
                }
            }

            // Emulate a `UILongPressGestureRecognizer` on iOS. Which [waits for a touch to
            // last 0.5 seconds][1] before firing.
            //
            // [1]: https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            const longTouchTimeout = createTimeout(() => {
                ourTouchState.longTouchTimeout = null;

                // Unfocus whatever the focused element is to close the keyboard.
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }

                NativeMobileBridge?.haptic.playMediumImpact();

                const containerRect = containerElement.getBoundingClientRect();

                setTouchMenuState({
                    isAnimatingOut: false,
                    top: ourTouchState.initialClientY - containerRect.top,
                    left: ourTouchState.initialClientX - containerRect.left,
                });
            }, 500);

            // Support the case where we have 0 touches since this happens in integration
            // tests. Shouldn't happen in a production browser.
            const touch = event.touches[0] ?? {clientX: 0, clientY: 0};

            const ourTouchState: MessageViewTouchState = {
                gesture: null,
                hasReplyGestureActivated: false,
                isReplyGestureDisabled,
                initialClientX: touch.clientX,
                initialClientY: touch.clientY,
                longTouchTimeout,
                finishGesture: null,
            };
            touchState = ourTouchState;
            setShowTouchReplyIcon(true);
        };

        const handleTouchEnd = () => {
            touchState?.longTouchTimeout?.clear();
            const gestureFinishedPromise = touchState?.finishGesture?.();
            const hasReplyGestureActivated = touchState?.hasReplyGestureActivated ?? false;
            touchState = null;

            if (!gestureFinishedPromise) {
                setShowTouchReplyIcon(false);
            } else {
                void gestureFinishedPromise.finally(() => setShowTouchReplyIcon(false));
            }

            if (hasReplyGestureActivated) {
                events.onReplyToMessage();
            }
        };

        const handleTouchMove = (event: TouchEvent) => {
            touchState?.longTouchTimeout?.clear();
            if (touchState) touchState.longTouchTimeout = null;

            if (!touchState || event.touches.length !== 1) return;
            const touch = event.touches[0]!;

            if (touchState.gesture === null) {
                const clientXDifferenceMagnitude = Math.abs(
                    touch.clientX - touchState.initialClientX,
                );
                const clientYDifferenceMagnitude = Math.abs(
                    touch.clientY - touchState.initialClientY,
                );

                if (clientXDifferenceMagnitude > clientYDifferenceMagnitude) {
                    if (touch.clientX < touchState.initialClientX) {
                        touchState.gesture = "Other";
                    } else if (touchState.isReplyGestureDisabled) {
                        touchState.gesture = "Other";
                    } else {
                        touchState.gesture = "Reply";

                        touchState.finishGesture = () => {
                            const elements = [contentContainerElement];
                            if (parentMessageElement) elements.push(parentMessageElement);
                            if (accountAvatarContainerElement)
                                elements.push(accountAvatarContainerElement);

                            const touchReplyIconElement = touchReplyIconRef.current;

                            const remPx = getRemPxWithoutListening();

                            const animation = animate(
                                [
                                    [
                                        elements,
                                        {x: 0},
                                        {ease: parseCubicBezier(easeOutExpo.cubicBezier)},
                                    ],
                                    [
                                        touchReplyIconElement ?? [],
                                        {x: -0.75 * remPx, opacity: 0},
                                        {at: 0, ease: parseCubicBezier(easeOutExpo.cubicBezier)},
                                    ],
                                ],
                                {duration: 0.5},
                            );

                            return animation.finished;
                        };
                    }
                } else if (clientXDifferenceMagnitude < clientYDifferenceMagnitude) {
                    touchState.gesture = "Other";
                }
            }

            if (touchState.gesture === "Reply") {
                event.preventDefault();

                const translateX = Math.max(
                    0,
                    (touch.clientX - touchState.initialClientX - 10) *
                        // We slow the drag animation down to make it feel like the user is dragging
                        // something heavy. But also this ends up smoothing out the animation! We only
                        // get `touchmove` events every whole pixel. But on devices like iPhone every
                        // virtual pixel is actually rendered by 2 to 3 hardware pixels. So animating
                        // 1:1 with `touchmove` events can looking subtly coarse since we're jumping
                        // across multiple hardware pixels per move.
                        (1 / 2),
                );

                const elements = [contentContainerElement];
                if (parentMessageElement) elements.push(parentMessageElement);
                if (accountAvatarContainerElement) elements.push(accountAvatarContainerElement);

                const touchReplyIconElement = touchReplyIconRef.current;

                const remPx = getRemPxWithoutListening();

                const maxTranslateX = 1.25 * remPx;
                const progress = clamp(0, translateX / maxTranslateX, 1);

                if (progress === 1) {
                    if (!touchState.hasReplyGestureActivated) {
                        NativeMobileBridge?.haptic.playHeavyImpact();
                    }

                    touchState.hasReplyGestureActivated = true;
                } else {
                    touchState.hasReplyGestureActivated = false;
                }

                void animate(
                    [
                        [elements, {x: translateX}],
                        [
                            touchReplyIconElement ?? [],
                            {x: -0.75 * remPx * (1 - progress), opacity: progress},
                            {at: 0},
                        ],
                    ],
                    {duration: 0},
                );
            }
        };

        const handleTouchCancel = () => {
            touchState?.longTouchTimeout?.clear();
            const gestureFinishedPromise = touchState?.finishGesture?.();
            touchState = null;

            if (!gestureFinishedPromise) {
                setShowTouchReplyIcon(false);
            } else {
                void gestureFinishedPromise.finally(() => setShowTouchReplyIcon(false));
            }
        };

        contentContainerElement.addEventListener("touchstart", handleTouchStart);
        contentContainerElement.addEventListener("touchend", handleTouchEnd);
        contentContainerElement.addEventListener("touchmove", handleTouchMove, {passive: false});
        contentContainerElement.addEventListener("touchcancel", handleTouchCancel);

        return () => {
            contentContainerElement.removeEventListener("touchstart", handleTouchStart);
            contentContainerElement.removeEventListener("touchend", handleTouchEnd);
            contentContainerElement.removeEventListener("touchmove", handleTouchMove);
            contentContainerElement.removeEventListener("touchcancel", handleTouchCancel);
        };
    }, [
        canPrimaryInputHover,
        events,
        hasParentMessage,
        isEditingThisMessage,
        isReadOnly,
        message.payload,
    ]);

    // We try to memoize any UI in this component that changes infrequently to
    // speed up React rendering. Because `<MessageView>` renders during scroll
    // animations it's important to keep it fast.
    const contentPayloadNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        if (message.stream) {
            return (
                <MessageStreamView
                    content={message.payload.content}
                    stream={message.stream}
                    withUserSelectNone={!canPrimaryInputHover}
                    getClipboardSerializerPrefix={events.getClipboardSerializerPrefix}
                />
            );
        }

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
                    style={{
                        // Use a line height with a round pixel value on all spacing scales so
                        // `<MessageView>` elements don't end up needing subpixel rendering.
                        lineHeight: spacing["8"],
                    }}
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
                content={message.payload.content}
                contentUpdatedTime={message.payload.contentUpdatedTime}
                withUserSelectNone={!canPrimaryInputHover}
                getClipboardSerializerPrefix={events.getClipboardSerializerPrefix}
            />
        );
    }, [
        canPrimaryInputHover,
        events.getClipboardSerializerPrefix,
        message,
        messageTextForBigEmojiMessage,
    ]);

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
                    })}
                    style={{
                        lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
                    }}
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
    }, [message.payload, messageNoun, spacingScale]);

    const parentMessageNode = useMemo(() => {
        if (!parentMessage) return null;

        return (
            <MessageViewParent
                parentMessageRef={parentMessageRef}
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
            locale: clientInfo.locale,
            timeZone: clientInfo.timeZone,
        });

        return (
            <div
                className={sprinkles({
                    paddingTop: !isFirstMessage ? messageViewTimestampDividerMarginY : undefined,
                    paddingBottom: messageViewTimestampDividerMarginY,
                    display: "flex",
                    justifyContent: "center",
                    fontSize: "50",
                    fontStyle: "truncate",
                    color: "grey-50",
                })}
                style={{
                    // Use a spacing value that evaluates to a whole pixel number on all spacing
                    // scales. This way `<MessageView>` heights can be measured in whole pixels.
                    lineHeight: spacing[messageViewTimestampDividerHeight],
                }}
            >
                {formattedDate}
            </div>
        );
    }, [
        clientInfo.locale,
        clientInfo.timeZone,
        currentTime,
        isFirstMessage,
        message.createdTime,
        shouldShowTimestampBeforeMessage,
    ]);

    const id = useId();

    const isMessageHighlighted: boolean = useMemo(
        () =>
            !!touchMenuState ||
            (openContextMenuActions ?? []).some(subActions =>
                ("actions" in subActions ? subActions.actions : subActions).some(
                    action => !action.withCustomLayout && action.key === id,
                ),
            ),
        [touchMenuState, openContextMenuActions, id],
    );

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
                isDisabled={!!messageEditingForThisMessage}
                actions={events.getContextMenuActions}
                // Merge the text copy action into the "Copy link" section.
                mergeReadonlyCopyAction={(actionSections, copyTextAction) => {
                    const copyLinkActionSectionIndex = actionSections.findIndex(actionSection =>
                        ("actions" in actionSection ? actionSection.actions : actionSection).some(
                            action => !action.withCustomLayout && action.label === "Copy link",
                        ),
                    );

                    if (copyLinkActionSectionIndex === -1) {
                        return [[copyTextAction], ...actionSections];
                    }

                    const newActionSections = [...actionSections];
                    const copyLinkActionSection = assertExists(
                        newActionSections[copyLinkActionSectionIndex],
                    );

                    newActionSections[copyLinkActionSectionIndex] = [
                        {...copyTextAction, label: "Copy text"},
                        ...("actions" in copyLinkActionSection
                            ? copyLinkActionSection.actions
                            : copyLinkActionSection),
                    ];

                    return newActionSections;
                }}
                extraOverlayBottom={
                    <MessageViewMenuCreatedTime
                        createdTime={message.createdTime}
                        // Only show the updated time if the user can't hover over the "(edited)" text
                        // to see it.
                        contentUpdatedTime={
                            !canPrimaryInputHover && message.payload.type === "Content"
                                ? message.payload.contentUpdatedTime
                                : null
                        }
                        deletedTime={
                            !canPrimaryInputHover && message.payload.type === "Deleted"
                                ? message.payload.deletedTime
                                : null
                        }
                    />
                }
            >
                <div
                    ref={containerRef}
                    className={classNames(
                        sprinkles({
                            position: "relative",
                            width: "full",
                            maxWidth: contentStyles.contentMaxWidth,
                            marginX: "auto",
                            paddingX: screenPaddingX,
                            paddingBottom: marginBottom,
                        }),
                        shouldShowOptimisticLoadingIndicator &&
                            pulseAnimationWithReducedOpacityClassName,
                    )}
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
                    <ContentBlockWidthContextProvider
                        maxWidth={contentStyles.contentMaxWidth}
                        paddingLeft={addRemLengths(screenPaddingX[platform], messageViewMarginLeft)}
                        paddingRight={screenPaddingX[platform]}
                    >
                        {parentMessageNode}
                        <div
                            className={sprinkles({
                                position: "relative",
                                zIndex:
                                    // NOTE(calebmer): If the user is editing a message we render
                                    // `<MessageViewEditor>` which renders `<InlineEditorToolbar>` which needs to
                                    // render on top of `<MessageViewParent>`.
                                    //
                                    // Fixes:
                                    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/cwvja89b8vmbajqytsa3926h00
                                    message.payload.type === "Content" &&
                                    messageEditingForThisMessage
                                        ? "20"
                                        : "0",
                                display: "flex",
                                gap: messageViewRailGap,
                            })}
                        >
                            {useMemo(
                                () => (
                                    <div
                                        ref={accountAvatarContainerRef}
                                        className={sprinkles({
                                            flexShrink: "0",
                                            width: messageViewAccountAvatarSize,
                                        })}
                                    >
                                        {!shouldMergeWithPreviousMessage && (
                                            <div
                                                className={sprinkles({position: "relative"})}
                                                style={{
                                                    top: messageViewAvatarOffsetYPx[spacingScale],
                                                }}
                                            >
                                                <AccountAvatar
                                                    account={messageAuthor}
                                                    size={messageViewAccountAvatarSize}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ),
                                [messageAuthor, shouldMergeWithPreviousMessage, spacingScale],
                            )}
                            <div
                                ref={contentContainerRef}
                                data-testid={
                                    process.env.NODE_ENV !== "production"
                                        ? "MessageViewContent"
                                        : undefined
                                }
                                className={sprinkles({flexGrow: "1"})}
                                style={{
                                    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                    // have `min-width: auto` which extends with content.
                                    // https://stackoverflow.com/a/66689926/1568890
                                    minWidth: 0,
                                    ...(isMessageHighlighted
                                        ? assignInlineVars({
                                              [backgroundColorVar]: colorSchemeVars["grey-5"],
                                          })
                                        : null),
                                }}
                            >
                                {!shouldMergeWithPreviousMessage && (
                                    <div
                                        className={sprinkles({
                                            maxWidth: "full",
                                            // Make sure the `z-index` is higher than our content so the `<IconButton>`
                                            // can but clicked even where it overlaps with content.
                                            zIndex: "10",
                                            position: "relative",
                                            height: messageViewAccountNameHeight,
                                            display: "flex",
                                            alignItems: "center",
                                        })}
                                    >
                                        <div
                                            className={sprinkles({
                                                fontSize: messageViewAccountNameFontSize,
                                                fontStyle: "truncate",
                                                color: "grey-60",
                                            })}
                                            style={{
                                                lineHeight: spacing[messageViewAccountNameHeight],
                                            }}
                                        >
                                            {message.payload.type === "Content" &&
                                            message.payload.clerical?.type ===
                                                "ShareNotification" ? (
                                                <>
                                                    <AccountShortName account={messageAuthor} />{" "}
                                                    shared a{" "}
                                                    {getFileEntityNoun(
                                                        message.payload.clerical.entityType,
                                                    )}{" "}
                                                    with you
                                                </>
                                            ) : (
                                                messageAuthor.name
                                            )}
                                        </div>
                                        {message.isOptimistic &&
                                            message.optimisticRequestErrorState.hasError && (
                                                <>
                                                    <div className={sprinkles({flexShrink: "0"})}>
                                                        &nbsp;
                                                    </div>
                                                    <IconButton
                                                        // NOTE(calebmer): I think we can use "click" in copy here since the
                                                        // description is part of a tooltip which is fundamentally a mouse/pointer
                                                        // thing. On mobile we need to pop open a modal or alert or something.
                                                        description={`Couldn’t ${
                                                            messageNoun === "message"
                                                                ? "send"
                                                                : "create"
                                                        } ${messageNoun}. Click to try again.`}
                                                        size="sm"
                                                        onPress={
                                                            message.optimisticRequestErrorState
                                                                .retry
                                                        }
                                                    >
                                                        <ErrorIcon />
                                                    </IconButton>
                                                </>
                                            )}
                                    </div>
                                )}
                                {message.payload.type === "Content" ? (
                                    !messageEditingForThisMessage ? (
                                        contentPayloadNode
                                    ) : (
                                        <MessageViewEditor
                                            ref={messageEditorRef}
                                            messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                            isLastMessage={isLastMessage}
                                            shouldMergeWithPreviousMessage={
                                                shouldMergeWithPreviousMessage
                                            }
                                            messageEditing={messageEditing}
                                            lastContentUpdatedTime={
                                                message.payload.contentUpdatedTime
                                            }
                                        />
                                    )
                                ) : (
                                    deletedPayloadNode
                                )}
                                {message.payload.type === "Content" &&
                                    message.payload.files.length > 0 && (
                                        <MessageViewFiles
                                            attachmentTarget={fileAttachmentTarget}
                                            files={message.payload.files}
                                            paddingTop={
                                                contentPayloadNode !== null
                                                    ? // It feels like too much space when we have a single line of text over a file.
                                                      // So special case a single non-standalone margin node above a file and in this
                                                      // case use paragraph margins instead of standalone block margins.
                                                      message.payload.content.doc.childCount ===
                                                          1 &&
                                                      !hasStandaloneMarginByContentBlockNodeTypeName[
                                                          message.payload.content.doc.firstChild!
                                                              .type.name
                                                      ]
                                                        ? contentStyles.paragraphMargin
                                                        : contentStyles.standaloneBlockMargin
                                                    : undefined
                                            }
                                        />
                                    )}
                            </div>
                            {isMessageHighlighted && (
                                <div
                                    className={sprinkles({
                                        position: "absolute",
                                        top: `-${messageViewOutlineMargin}`,
                                        height: "full",
                                        left: `-${messageViewOutlineMargin}`,
                                        right: `-${messageViewOutlineMargin}`,
                                        zIndex: "-10",
                                        backgroundColor: "grey-5",
                                        borderRadius: messageViewOutlineBorderRadius,
                                    })}
                                    style={{
                                        height: `calc(100% + ${addRemLengths(
                                            messageViewOutlineMargin,
                                            messageViewOutlineMargin,
                                        )})`,
                                        // If this is one line of text then the background should extend below
                                        // the avatar.
                                        minHeight: !shouldMergeWithPreviousMessage
                                            ? messageViewNotMergedOutlineMinHeightPx[spacingScale]
                                            : undefined,
                                    }}
                                />
                            )}
                            {showTouchReplyIcon && (
                                <div
                                    ref={touchReplyIconRef}
                                    className={sprinkles({
                                        zIndex: "-10",
                                        position: "absolute",
                                        left: "0.5",
                                        width: "5",
                                        height: "5",
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
                                        top: !shouldMergeWithPreviousMessage
                                            ? `calc(${spacing[messageViewAccountNameHeight]} + (100% - ${spacing[messageViewAccountNameHeight]}) / 2 - ${spacing["2.5"]})`
                                            : `calc(50% - ${spacing["2.5"]})`,
                                    }}
                                >
                                    <ArrowArcLeft size={spacing["3"]} />
                                </div>
                            )}
                        </div>
                        {touchMenuState && (
                            <MessageViewTouchMenu
                                messageNoun={messageNoun}
                                message={message}
                                isReadOnly={isReadOnly}
                                top={touchMenuState.top}
                                left={touchMenuState.left}
                                messageEditing={messageEditing}
                                getMessageUrl={getMessageUrl}
                                onReplyToMessage={events.onReplyToMessage}
                                onShowDeleteConfirmationDialog={() =>
                                    setShowDeleteConfirmationDialog(true)
                                }
                                isAnimatingOut={touchMenuState.isAnimatingOut}
                                onCloseWithoutAnimation={() => setTouchMenuState(null)}
                                onCloseWithAnimation={() =>
                                    setTouchMenuState({...touchMenuState, isAnimatingOut: true})
                                }
                            />
                        )}
                    </ContentBlockWidthContextProvider>
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
    parentMessageRef,
    messageNoun,
    parentMessage,
    onJumpToMessage,
}: {
    parentMessageRef: RefObject<HTMLDivElement>;
    messageNoun: string;
    parentMessage: Message;
    onJumpToMessage: Memo<(message: Message) => void>;
}) {
    const spacingScale = useSpacingScale();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();

    const truncatedContent = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    getTruncatedMessageContentForReplyPreview(get, {
                        message: parentMessage,
                        messageNoun,
                        accountRegistry,
                        searchEntityRegistry,
                        fileRegistry,
                    }),
                ),
            [accountRegistry, fileRegistry, messageNoun, parentMessage, searchEntityRegistry],
        ),
    );

    const marginTop = "2";
    const marginBottom = "2";
    const accountAvatarSizeRem = parseRemLength(messageViewAccountAvatarSize);
    const parentMessageOffsetRem = parseRemLength(messageViewRailGap) / 2;
    const parentMessageAccountAvatarSizeRem = parseRemLength(messageViewParentAccountAvatarSize);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            onJumpToMessage(parentMessage);
        },
    });

    return (
        <FocusRing offset="1" insetX="0.5" insetBottom="0.5">
            <div
                {...pressProps}
                ref={parentMessageRef}
                data-testid={
                    process.env.NODE_ENV !== "production" ? "MessageViewParent" : undefined
                }
                // This is a simulated link. When the user clicks on it our code navigates us
                // to the right message instead of relying on browser URL navigation.
                //
                // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                role="link"
                tabIndex={0}
                className={sprinkles({
                    position: "relative",
                    zIndex: "10",
                    // `inline-flex` instead of `flex` so that the clickable area doesn't extend
                    // full width when we have a short message.
                    display: "inline-flex",
                    gap: "1.5",
                    marginTop,
                    marginBottom,
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
                    maxWidth: "full",
                })}
                style={{
                    marginLeft: `${accountAvatarSizeRem + parentMessageOffsetRem}rem`,
                }}
            >
                <div
                    className={sprinkles({
                        pointerEvents: "none",
                        position: "absolute",
                        borderLeftWidth: "thick",
                        borderTopWidth: "thick",
                        borderTopLeftRadius: "2.5",
                    })}
                    style={{
                        // We render the border left/top color as a white with some opacity (which when
                        // blended results in `grey-5`) so that when we render the context menu (right
                        // click) `grey-5` background the border is rendered on top of the background
                        // color.
                        borderLeftColor: colorSchemeVars["grey-5-translucent"],
                        borderTopColor: colorSchemeVars["grey-5-translucent"],
                        borderStyle: "solid",

                        top: `calc(${
                            messageViewParentAvatarOffsetYRem +
                            parentMessageAccountAvatarSizeRem / 2
                        }rem - 1px)`,
                        bottom: `calc(-${spacing[marginBottom]} - ${
                            messageViewAvatarOffsetYPx[spacingScale] - 2
                        }px)`,
                        left: `calc(-${
                            accountAvatarSizeRem / 2 + parentMessageOffsetRem
                        }rem - 1px)`,
                        width: `calc(${
                            accountAvatarSizeRem / 2 + parentMessageOffsetRem
                        }rem - 2px)`,
                    }}
                />
                <div
                    className={sprinkles({
                        flexShrink: "0",
                        position: "relative",
                        height: "0",
                        opacity: isPressed ? "60" : "100",
                    })}
                    style={{top: `${messageViewParentAvatarOffsetYRem}rem`}}
                >
                    <AccountAvatar
                        size={messageViewParentAccountAvatarSize}
                        account={parentMessage.author}
                    />
                </div>
                <div
                    className={sprinkles({
                        overflow: "hidden",
                        color: "grey-80",
                        fontSize: messageViewParentFontSize,
                        fontStyle: "normal",
                        opacity: isPressed ? "60" : "100",
                    })}
                    style={{
                        minHeight: messageViewParentLineHeightPx[spacingScale],
                        lineHeight: `${messageViewParentLineHeightPx[spacingScale]}px`,
                        // Allow contextual alternate glyphs in regular text content.
                        // eslint-disable-next-line string-quotes
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

function MessageViewMenuCreatedTime({
    createdTime,
    contentUpdatedTime,
    deletedTime,
}: {
    createdTime: Date;
    contentUpdatedTime: Date | null;
    deletedTime: Date | null;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const formattedCreatedTime = useMemo(
        () =>
            formatMessageViewTimestampDividerDate(createdTime, {
                currentTime,
                locale,
                timeZone,
            }),
        [createdTime, currentTime, locale, timeZone],
    );

    const formattedContentUpdatedTime = useMemo(
        () =>
            contentUpdatedTime
                ? formatMessageViewTimestampDividerDate(contentUpdatedTime, {
                      currentTime,
                      locale,
                      timeZone,
                  })
                : null,
        [contentUpdatedTime, currentTime, locale, timeZone],
    );

    const formattedDeletedTime = useMemo(
        () =>
            deletedTime
                ? formatMessageViewTimestampDividerDate(deletedTime, {
                      currentTime,
                      locale,
                      timeZone,
                  })
                : null,
        [currentTime, deletedTime, locale, timeZone],
    );

    return (
        <>
            <div className={sprinkles({padding: "1"})}>
                <div className={sprinkles({width: "full", borderBottom: "grey-5"})} />
            </div>
            <div
                className={sprinkles({
                    paddingX: "2",
                    paddingY: {desktop: "1", mobile: "1.5"},
                    fontSize: "50",
                    color: "grey-50",
                })}
            >
                <div>
                    {(formattedContentUpdatedTime || formattedDeletedTime) && <>Sent: </>}
                    {formattedCreatedTime}
                </div>
                {formattedDeletedTime ? (
                    <div className={sprinkles({paddingTop: "1"})}>
                        Deleted: {formattedDeletedTime}
                    </div>
                ) : formattedContentUpdatedTime ? (
                    <div className={sprinkles({paddingTop: "1"})}>
                        Edited: {formattedContentUpdatedTime}
                    </div>
                ) : null}
            </div>
        </>
    );
}

function MessageViewTouchMenu<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun,
    message,
    isReadOnly,
    top,
    left,
    messageEditing,
    getMessageUrl,
    onReplyToMessage,
    onShowDeleteConfirmationDialog,
    isAnimatingOut,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    messageNoun: string;
    message: Message | OptimisticMessageModel;
    isReadOnly: boolean;
    top: number;
    left: number;
    messageEditing: MessageEditing<RoomKey>;
    getMessageUrl: (messageIndex: number) => URL;
    onReplyToMessage: () => void;
    onShowDeleteConfirmationDialog: () => void;
    isAnimatingOut: boolean;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const {currentAccount, space} = useSpaceContext();

    const menuActions: Array<ReadonlyArray<MenuAction>> = [];

    // Don't allow replying if the message payload is empty. The UI shouldn't
    // normally allow saving an empty message payload. We allow empty message
    // payloads for messages that have attached files, however. In this special
    // case we don't want to allow the user to reply since the reply message will
    // include no text.
    if (
        !isReadOnly &&
        message.payload.type === "Content" &&
        !isContentEmpty(message.payload.content.doc)
    ) {
        menuActions.push([
            {
                label: "Reply",
                icon: <ArrowArcRight />,
                iconPlacement: "end",
                onPress: onReplyToMessage,
            },
        ]);
    }

    const copyMenuActions: Array<MenuAction> = [];
    menuActions.push(copyMenuActions);

    if (message.payload.type === "Content") {
        copyMenuActions.push({
            label: "Copy text",
            icon: <Copy />,
            iconPlacement: "end",
            pressErrorTitle: `Couldn’t copy ${messageNoun} text`,
            onPress: async () => {
                assert(message.payload.type === "Content");

                await writeContentToClipboard(space.id, message.payload.content, null);
            },
        });
    }

    copyMenuActions.push({
        label: "Copy link",
        icon: <LinkIcon />,
        iconPlacement: "end",
        isDisabled: message.isOptimistic,
        pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
        onPress: async () => {
            if (message.isOptimistic) return;
            await writeTextToClipboard(getMessageUrl(message.index).toString());
        },
    });

    if (
        !isReadOnly &&
        currentAccount?.id === message.author.id &&
        message.payload.type === "Content" &&
        // Can't update or delete clerical messages.
        !message.payload.clerical
    ) {
        const messagePayload = message.payload;

        const editContextMenuActions: Array<MenuAction> = [];
        menuActions.push(editContextMenuActions);

        // Don't allow editing if the message payload is empty. The UI shouldn't
        // normally allow saving an empty message payload. We allow empty message
        // payloads for messages that have attached files, however. In this special
        // case we don't want to allow the user to add text alongside the files.
        if (!isContentEmpty(messagePayload.content.doc)) {
            editContextMenuActions.push({
                label: "Edit",
                isDisabled: message.isOptimistic,
                onPress: () => {
                    if (message.isOptimistic) return;

                    messageEditing.dispatch({
                        type: "StartEditing",
                        messageIndex: message.index,
                        messageRoomKey: message.getRoomKey(),
                        messagePayload,
                        platform,
                        returnFocusAfterEditing: null,
                    });
                },
            });
        }

        editContextMenuActions.push({
            label: "Delete",
            onPress: onShowDeleteConfirmationDialog,
        });
    }

    return (
        <OverlayAnimated
            placement="bottom"
            offset="4"
            isVisible={!isAnimatingOut}
            disableAnimationIn={true}
            onActuallyVisibleChange={isActuallyVisible => {
                if (!isActuallyVisible) onCloseWithoutAnimation();
            }}
            isBlocking={true}
            overlay={
                <div ref={useOutsideInteraction(onCloseWithAnimation)}>
                    <Menu
                        actions={menuActions}
                        extraBottom={
                            <MessageViewMenuCreatedTime
                                createdTime={message.createdTime}
                                contentUpdatedTime={
                                    message.payload.type === "Content"
                                        ? message.payload.contentUpdatedTime
                                        : null
                                }
                                deletedTime={
                                    message.payload.type === "Deleted"
                                        ? message.payload.deletedTime
                                        : null
                                }
                            />
                        }
                        onCloseWithAnimation={onCloseWithAnimation}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                </div>
            }
        >
            <div
                className={sprinkles({
                    position: "absolute",
                    pointerEvents: "none",
                    width: "0",
                    height: "0",
                })}
                style={{top, left}}
            ></div>
        </OverlayAnimated>
    );
}
