import {usePress} from "@react-aria/interactions";
import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {animate} from "motion";
import {ArrowArcLeft, ArrowArcRight, Link as LinkIcon, Trash} from "phosphor-react";
import {
    Fragment,
    Memo,
    RefObject,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {
    useAccountModel,
    useAccountRegistry,
} from "~/client/web/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/web/content/has_standalone_margin_by_content_block_node_type_name.js";
import {disableMessagingViewPointerToolbarAnimationOutUntilAfterNextAnimationFrame} from "~/client/web/content/messaging/disable_messaging_view_pointer_toolbar_animation_out_until_after_next_animation_frame.js";
import {
    getTruncatedMessageContentForReplyPreview,
    getTruncatedMessagesRangeContentForReplyPreview,
    getTruncatedPostContentForReplyPreview,
} from "~/client/web/content/messaging/get_truncated_message_content_for_reply_preview.js";
import {MessageContentPayloadParentWithMessages} from "~/client/web/content/messaging/message_input_base.js";
import {MessageViewFiles} from "~/client/web/content/messaging/message_view_files.js";
import {
    ContextMenuActions,
    addContextMenuActionsToPreviousSection,
    hasContextMenuAction,
    hasContextMenuActionWithKey,
    useContextMenuActions,
} from "~/client/web/design/context_menu.js";
import {ErrorIcon} from "~/client/web/design/error_icon.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/web/design/pretty_absolute_date.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {formatMessageViewTimestampDividerDate} from "~/client/web/messaging/format_message_view_timestamp_divider_date.js";
import {getMessageTextForBigEmojiMessage} from "~/client/web/messaging/internal/get_message_text_for_big_emoji_message.js";
import {getMessageViewMarginBottom} from "~/client/web/messaging/internal/get_message_view_margin_bottom.js";
import {MessageDeleteConfirmationDialog} from "~/client/web/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageStreamView} from "~/client/web/messaging/internal/message_stream_view.js";
import {
    MessageViewEditor,
    MessageViewEditorRef,
} from "~/client/web/messaging/internal/message_view_editor.js";
import {MessageViewMenuStateUpdatedTime} from "~/client/web/messaging/internal/message_view_menu_state_updated_time.js";
import {messageViewReactionContextMenuAction} from "~/client/web/messaging/internal/message_view_reaction_context_menu_action.js";
import {shouldMergeMessages} from "~/client/web/messaging/internal/should_merge_messages.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {MessageViewTouchMenu} from "~/client/web/messaging/message_view_touch_menu.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
    deleteMessageReactionWithOptimisticUpdate,
    setMessageReactionWithOptimisticUpdate,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {
    JumpMessageState,
    JumpToMessageRangeOptions,
} from "~/client/web/messaging/use_jump_to_message_range.js";
import {JumpToPostRangeOptions} from "~/client/web/messaging/use_jump_to_post_range.js";
import {
    ContentViewReactionParty,
    ContentViewWithReactionParties,
} from "~/client/web/reactions/content_view_with_reaction_parties.js";
import {reactionButtonContextMenuActionKey} from "~/client/web/reactions/reaction_button.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useCanPrimaryInputHover, usePlatform} from "~/client/web/remix/platform_context.js";
import {
    getRemPxWithoutListening,
    useSpacingScale,
} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    messageViewAccountAvatarSize,
    messageViewAccountNameFontSize,
    messageViewAccountNameHeight,
    messageViewAvatarOffsetYPx,
    messageViewBigEmojiLineHeight,
    messageViewMarginLeft,
    messageViewNotMergedOutlineMinHeightPx,
    messageViewOutlineBorderRadius,
    messageViewOutlineMargin,
    messageViewParentAccountAvatarSize,
    messageViewParentAvatarOffsetYRem,
    messageViewParentFontSize,
    messageViewParentLineClamp,
    messageViewParentLineHeightPx,
    messageViewParentMarginBottom,
    messageViewParentMarginTop,
    messageViewRailGap,
    messageViewTimestampDividerHeight,
    messageViewTimestampDividerMarginY,
} from "~/client/web/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    contentViewStyles,
    emojiFontFamily,
    messagingStyles,
    pulseAnimationWithReducedOpacityClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {linkClassName} from "~/shared/design/core/constant_class_names.js";
import {easeOutExpo, parseCubicBezier} from "~/shared/design/core/easing.js";
import {
    RemLength,
    addRemLengths,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {InternalError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {mapMessagePosFromContentVersion} from "~/shared/messaging/map_message_pos_from_content_version.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/notifications/min_message_view_timestamp_divider_elapsed_minutes.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {computeStore} from "~/shared/store/compute_store.js";

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height divided by
 * the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

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
    postRoom,
    jumpState,
    onJumpToMessageRange,
    onJumpToPostRange,
    onReplyToMessage: onReplyToMessageProp,
    onDeleteMessage,
    getMessageUrl,
    onSetMessageReaction,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
    roomDisplayedCreatedTime,
    isReadOnly = false,
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
    postRoom?: PostModel;
    disableExpensiveFeaturesDuringScroll: boolean;
    jumpState: JumpMessageState | null;
    onJumpToMessageRange: Memo<(options: JumpToMessageRangeOptions<RoomKey>) => void>;
    onJumpToPostRange?: Memo<(options: JumpToPostRangeOptions) => void>;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    getMessageUrl: (messageIndex: number) => URL;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>>;
    roomDisplayedCreatedTime?: Date;
    isReadOnly?: boolean;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const clientInfo = useClientInfo();
    const navigate = useNavigate();
    const reporter = useReporter();
    const {currentAccount, space} = useSpaceContext();
    const currentTime = useCurrentTimeRoundedToHour();
    const openContextMenuActions = useContextMenuActions();
    const inboxContext = useInboxContext();

    const currentAccountId = currentAccount?.id;

    const messageAuthor = useAccountModel(message.author);

    const containerRef = useRef<HTMLDivElement>(null);
    const parentMessageRef = useRef<HTMLDivElement>(null!);
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
        return getMessageViewMarginBottom({
            isLastMessage,
            message,
            nextMessage,
            shouldMergeWithNextMessage,
        });
    }, [isLastMessage, message, nextMessage, shouldMergeWithNextMessage]);

    const parent = useMemo((): MessageContentPayloadParentWithMessages<RoomKey, Message> | null => {
        if (message.payload.type !== "Content" || !message.payload.parent) return null;

        const {parent} = message.payload;

        switch (parent.type) {
            case "Message": {
                const message = messages.getLoadedMessageIfExists(parent.index);
                if (!message) return null;
                return {type: "Message", message};
            }
            case "MessagesRange": {
                const parentMessages: Array<Message> = [];

                for (let index = parent.startIndex; index <= parent.endIndex; index++) {
                    const message = messages.getLoadedMessageIfExists(index);
                    if (!message) return null;
                    parentMessages.push(message);
                }

                return {...parent, messages: assertNonEmptyReadonlyArray(parentMessages)};
            }
            case "PostRange": {
                if (!postRoom) {
                    throw new InternalError("Post range parent may only be used in a post room");
                }

                return {...parent, post: postRoom};
            }
            default:
                throw exhaustive(parent);
        }
    }, [message.payload, messages, postRoom]);

    const messageEditingForThisMessage =
        // If we're on a mobile device (with keyboard toolbars) then instead of editing a
        // message inline, we edit it within the sticky `<MessageInput>`.
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
        // When we finish editing, call the return focus function if there was one on our
        // message editing state.
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
        // Use a longer timeout than `delayLoadingIndicatorLimitMs` since most of the time
        // the optimistic placement is the correct end state.
        delayLoadingIndicatorLimitMs * 2,
    );

    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const messageTextForBigEmojiMessage = useMemo(
        () => getMessageTextForBigEmojiMessage(message),
        [message],
    );

    const events = useEvents({
        getClipboardSerializerAuthorPrefix: () => {
            if (shouldMergeWithPreviousMessage) return null;
            return message.author;
        },

        onReplyToMessage: () => {
            // If we're currently editing a message on mobile then cancel editing when trying
            // to reply to a message. Otherwise `<MessageInput>` will override the reply state
            // with editing state.
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
        //
        // NOTE: This only handles the context menu on devices with a right click. Touch
        // devices use a different context menu. If you update the context menu here, you
        // may also want to update the touch menu in `MessageViewTouchMenu`.
        getContextMenuActions: (event: MouseEvent) => {
            // If the user right clicked on a `<ReactionButton>` in the message then only show
            // the reaction button's context menu actions. Don't show the message context menu
            // actions.
            if (hasContextMenuActionWithKey(event, reactionButtonContextMenuActionKey)) {
                return [];
            }

            const containerElement = assertExists(containerRef.current);
            const selection = window.getSelection();

            // If the `contextmenu` event target is outside of the selection then empty out the
            // selection. The user is right-clicking this message, not the selection. This
            // mirrors the behavior of `<ContextMenuContextProvider>` which calls
            // `selection?.empty()` as well if `event.target` is outside the selection.
            if (event.target instanceof Node && selection?.containsNode(event.target, true)) {
                // If the selection spans multiple messages then we don't want to add context menu
                // actions for a single message. Instead we should only show "Copy".
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
            const menuActions: Array<MenuAction> = [];

            // Don't allow replying if the message payload is empty. The UI shouldn't normally
            // allow saving an empty message payload. We allow empty message payloads for
            // messages that have attached files, however. In this special case we don't want
            // to allow the user to reply since the reply message will include no text.
            if (
                !isReadOnly &&
                !message.isOptimistic &&
                message.payload.type === "Content" &&
                (!isContentEmpty(message.payload.content.doc) ||
                    (message.stream !== null &&
                        message.stream.parts.some(
                            part =>
                                part.payload.type === "Content" &&
                                !isContentEmpty(part.payload.content),
                        )))
            ) {
                contextMenuActions.push([
                    {
                        label: "Reply",
                        icon: <ArrowArcRight />,
                        iconPlacement: "end",
                        onPress: () => {
                            // Remove the selection at the same time we set the reply on the message input. So
                            // `<MessagingViewPointerToolbar>` doesn't render as our right click menu closes.
                            // Also make sure we don't animate out `<MessagingViewPointerToolbar>` when we hide
                            // it otherwise it'll flash in once the context menu closes and animate out now
                            // that the selection is removed.
                            //
                            // For a video reproducing the bug we're fixing here see:
                            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/pkfkhjsvv634ebb56kafcsy6rr
                            disableMessagingViewPointerToolbarAnimationOutUntilAfterNextAnimationFrame();
                            window.getSelection()?.removeAllRanges();

                            events.onReplyToMessage();
                        },
                    },
                ]);

                menuActions.push(
                    messageViewReactionContextMenuAction({
                        message,
                        messageNoun,
                        onSetMessageReaction,
                        onDeleteMessageReaction,
                        onUpdateMessagesOptimistically,
                        inboxContext,
                    }),
                );

                contextMenuActions.push(menuActions);
            }

            // Add reaction action for file-only messages (messages with files but no text
            // content). Reply is not available since there's no text to quote.
            else if (
                !isReadOnly &&
                !message.isOptimistic &&
                message.payload.type === "Content" &&
                message.payload.files.length > 0 &&
                isContentEmpty(message.payload.content.doc) &&
                message.stream === null
            ) {
                contextMenuActions.push([
                    messageViewReactionContextMenuAction({
                        message,
                        messageNoun,
                        onSetMessageReaction,
                        onDeleteMessageReaction,
                        onUpdateMessagesOptimistically,
                        inboxContext,
                    }),
                ]);
            }

            const isCopyLinkMenuAction = (action: MenuAction) =>
                !action.withCustomLayout &&
                action.label.startsWith("Copy ") &&
                action.label.endsWith(" link");

            const hasOtherCopyLinkMenuAction = hasContextMenuAction(event, isCopyLinkMenuAction);

            const copyLinkMenuAction: MenuAction = {
                key: id,
                // If there's another "Copy" context menu action (e.g. "Copy document link" when
                // right clicking on a document file entity) then a menu action saying "Copy link"
                // (to copy the message link) would be confusing. So disambiguate what this item is
                // copying with the `messageNoun` (either "message" or "comment") so you end up
                // with "Copy document link" and "Copy message link".
                label: hasOtherCopyLinkMenuAction ? `Copy ${messageNoun} link` : "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                isDisabled: message.isOptimistic,
                pressErrorTitle: `Couldn\u2019t copy ${messageNoun} link`,
                onPress: async () => {
                    if (message.isOptimistic) return;
                    await writeTextToClipboard(getMessageUrl(message.index).toString());
                },
            };

            if (hasOtherCopyLinkMenuAction) {
                addContextMenuActionsToPreviousSection(event, isCopyLinkMenuAction, [
                    copyLinkMenuAction,
                ]);
            } else {
                contextMenuActions.push([copyLinkMenuAction]);
            }

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

                // Don't allow editing if the message payload is empty. The UI shouldn't normally
                // allow saving an empty message payload. We allow empty message payloads for
                // messages that have attached files, however. In this special case we don't want
                // to allow the user to add text alongside the files.
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

            // If the user can hover, let them hover over the message to see message actions.
            // Instead of opening a lightbox on touch which conflicts with text selection.
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

                    // If the user is touching a horizontally scrollable element (e.g. a code block)
                    // then disable the reply gesture if it's been scrolled since swiping horizontally
                    // should scroll. Not reply.
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
            // [1]:
            //     https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
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
                        // something heavy. But also this ends up smoothing out the animation! We only get
                        // `touchmove` events every whole pixel. But on devices like iPhone every virtual
                        // pixel is actually rendered by 2 to 3 hardware pixels. So animating 1:1 with
                        // `touchmove` events can looking subtly coarse since we're jumping across multiple
                        // hardware pixels per move.
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
    }, [canPrimaryInputHover, events, isEditingThisMessage, isReadOnly, message.payload]);

    // Schedule the jump animation to run once `<MessageView>` mounts.
    useEffect(() => {
        if (!jumpState) return;
        jumpState.scheduleAnimation();
    }, [jumpState]);

    // If we're highlighting this message then get the correct `from` and `to`
    // positions based on the versioning information we have for the highlight.
    const jumpAnimation = useMemo(() => {
        if (message.payload.type !== "Content") return null;
        if (!jumpState?.animation) return null;

        let from: number | null;
        let to: number | null;

        if (jumpState.start === null) {
            from = null;
        } else {
            from = mapMessagePosFromContentVersion(
                message.payload,
                jumpState.start.contentVersion,
                jumpState.start.pos,
                1,
            );
        }

        if (jumpState.end === null) {
            to = null;
        } else {
            to = mapMessagePosFromContentVersion(
                message.payload,
                jumpState.end.contentVersion,
                jumpState.end.pos,
                -1,
            );
        }

        return {from, to, startTime: jumpState.animation.startTime};
    }, [jumpState, message.payload]);

    const reactionsByPos = useMemo(() => {
        if (message.payload.type !== "Content") return emptyMap;

        // If this is the last message in a messaging view and the message doesn't have any
        // reactions then we want to render the add reaction button so the user can quickly
        // add a reaction (dismissing the notification if they're in the inbox).
        //
        // Don't show the add reaction button on the content if there are files. The files
        // section will show its own add reaction button.
        if (
            !isReadOnly &&
            isLastMessage &&
            message.author.id !== currentAccountId &&
            message.payload.reactionsByPos.size === 0 &&
            message.payload.files.length === 0
        ) {
            return new Map([[message.payload.content.doc.content.size, emptyReactionSet]]);
        }

        return message.payload.reactionsByPos;
    }, [message.payload, message.author.id, isReadOnly, isLastMessage, currentAccountId]);

    const handleSetReaction = useCallback(
        (pos: number | "Files", reaction: Reaction | "GenericLike") => {
            if (message.isOptimistic) return;
            if (!currentAccountId) return;
            setMessageReactionWithOptimisticUpdate({
                reporter,
                currentAccountId,
                messageNoun,
                roomKey: message.getRoomKey(),
                messageIndex: message.index,
                contentVersion: message.payload.contentUpdate?.mappings.length ?? 0,
                pos,
                reaction,
                onSetMessageReaction,
                onUpdateMessagesOptimistically,
                inboxContext,
            });
        },
        [
            currentAccountId,
            inboxContext,
            message,
            messageNoun,
            onSetMessageReaction,
            onUpdateMessagesOptimistically,
            reporter,
        ],
    );

    const handleDeleteReaction = useCallback(
        (pos: number | "Files") => {
            if (message.isOptimistic) return;
            if (!currentAccountId) return;
            deleteMessageReactionWithOptimisticUpdate({
                reporter,
                currentAccountId,
                messageNoun,
                roomKey: message.getRoomKey(),
                messageIndex: message.index,
                contentVersion: message.payload.contentUpdate?.mappings.length ?? 0,
                pos,
                onDeleteMessageReaction,
                onUpdateMessagesOptimistically,
            });
        },
        [
            currentAccountId,
            message,
            messageNoun,
            onDeleteMessageReaction,
            onUpdateMessagesOptimistically,
            reporter,
        ],
    );

    // We try to memoize any UI in this component that changes infrequently to speed up
    // React rendering. Because `<MessageView>` renders during scroll animations it's
    // important to keep it fast.
    const contentPayloadNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        // Will be rendered by `streamNode` if the message has a stream.
        if (message.stream) return null;

        // If there's no content then don't render anything. This is mainly for file
        // rendering. You could have a message with empty content and just a file. In that
        // case the entire message should be the file.
        if (isContentEmpty(message.payload.content.doc)) {
            return null;
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

            const bigEmojiReactionsPos = message.payload.content.doc.content.size;
            const bigEmojiReactions = reactionsByPos.get(bigEmojiReactionsPos) || undefined;

            return (
                <>
                    <div
                        className={sprinkles({
                            fontSize: "600",
                            userSelect: canPrimaryInputHover ? "text" : "none",
                        })}
                        style={{
                            // Use a line height with a round pixel value on all spacing scales so
                            // `<MessageView>` elements don't end up needing subpixel rendering.
                            lineHeight: spacing[messageViewBigEmojiLineHeight],
                        }}
                    >
                        {children}
                        {message.payload.contentUpdate && (
                            <Tooltip
                                placement="bottom"
                                content={
                                    <PrettyAbsoluteDateTooltipContent
                                        date={message.payload.contentUpdate.time}
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
                    {bigEmojiReactions !== undefined && (
                        <ContentViewReactionParty
                            pos={bigEmojiReactionsPos}
                            reactions={bigEmojiReactions}
                            isReadOnly={isReadOnly}
                            onSetReaction={handleSetReaction}
                            onDeleteReaction={handleDeleteReaction}
                            onPressSeeReactions={async pos => {
                                if (message.isOptimistic) return;
                                if (!currentAccountId) return;

                                await navigate(
                                    message.getSeeReactionsUrl(
                                        space.id,
                                        message.payload.contentUpdate?.mappings.length ?? 0,
                                        pos,
                                    ),
                                );
                            }}
                            randomSeed={
                                message.isOptimistic
                                    ? `MessageView:optimistic`
                                    : `MessageView:${message.getRoomKey()}-${message.index}`
                            }
                        />
                    )}
                </>
            );
        }

        if (reactionsByPos.size === 0) {
            return (
                <ContentView
                    data-room={!message.isOptimistic ? message.getRoomKey() : undefined}
                    data-index={!message.isOptimistic ? message.index : undefined}
                    className={classNames(
                        contentStyles.messageDocClassName,
                        messagingStyles.withPointerToolbarClassName,
                    )}
                    content={message.payload.content}
                    contentUpdatedTime={message.payload.contentUpdate?.time}
                    withUserSelectNone={!canPrimaryInputHover}
                    getClipboardSerializerAuthorPrefix={events.getClipboardSerializerAuthorPrefix}
                    jumpAnimation={jumpAnimation}
                />
            );
        } else {
            return (
                <ContentViewWithReactionParties
                    data-room={!message.isOptimistic ? message.getRoomKey() : undefined}
                    data-index={!message.isOptimistic ? message.index : undefined}
                    className={classNames(
                        contentStyles.messageDocClassName,
                        messagingStyles.withPointerToolbarClassName,
                    )}
                    content={message.payload.content}
                    contentUpdatedTime={message.payload.contentUpdate?.time}
                    withUserSelectNone={!canPrimaryInputHover}
                    getClipboardSerializerAuthorPrefix={events.getClipboardSerializerAuthorPrefix}
                    jumpAnimation={jumpAnimation}
                    reactionsByPos={reactionsByPos}
                    isReadOnly={isReadOnly}
                    onSetReaction={handleSetReaction}
                    onDeleteReaction={handleDeleteReaction}
                    onPressSeeReactions={async pos => {
                        if (message.isOptimistic) return;
                        if (!currentAccountId) return;

                        await navigate(
                            message.getSeeReactionsUrl(
                                space.id,
                                message.payload.contentUpdate?.mappings.length ?? 0,
                                pos,
                            ),
                        );
                    }}
                />
            );
        }
    }, [
        canPrimaryInputHover,
        currentAccountId,
        events.getClipboardSerializerAuthorPrefix,
        handleDeleteReaction,
        handleSetReaction,
        isReadOnly,
        jumpAnimation,
        message,
        messageTextForBigEmojiMessage,
        navigate,
        reactionsByPos,
        space.id,
    ]);

    const streamNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;
        if (!message.stream) return null;

        return (
            <MessageStreamView
                message={message}
                isLastMessage={isLastMessage}
                content={message.payload.content}
                stream={message.stream}
                withUserSelectNone={!canPrimaryInputHover}
                getClipboardSerializerAuthorPrefix={events.getClipboardSerializerAuthorPrefix}
                jumpAnimation={jumpAnimation}
            />
        );
    }, [
        canPrimaryInputHover,
        events.getClipboardSerializerAuthorPrefix,
        isLastMessage,
        jumpAnimation,
        message,
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
        if (!parent) return null;

        return (
            <MessageViewParent
                parentMessageRef={parentMessageRef}
                messageNoun={messageNoun}
                parent={parent}
                onJumpToMessageRange={onJumpToMessageRange}
                onJumpToPostRange={onJumpToPostRange}
            />
        );
    }, [messageNoun, onJumpToMessageRange, onJumpToPostRange, parent]);

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

    const isMessageHighlightedFromContextMenu: boolean = useMemo(
        () =>
            !!touchMenuState ||
            (openContextMenuActions ?? []).some(subActions =>
                ("actions" in subActions ? subActions.actions : subActions).some(
                    action => !action.withCustomLayout && action.key === id,
                ),
            ),
        [touchMenuState, openContextMenuActions, id],
    );

    const editorHeightSpacerRef = useRef<HTMLDivElement>(null);

    // When we switch from not editing to editing, measure the current height of the
    // content container element. This runs before React makes any changes to the DOM.
    // So we'll get the content container height before it switches to the editor
    // component.
    //
    // I feel ok reading mutable state in a `useState()` initializer function (vs
    // `useMemo()` or directly in the React render function).
    const oldContentContainerHeightForEditorHeightDifference =
        useStateWithDependenciesWithoutDispatch(
            ([withHeight]) =>
                withHeight ? (contentContainerRef.current?.offsetHeight ?? 0) : null,
            [message.payload.type === "Content" && isEditingThisMessage],
        );

    // When we switch from not editing to editing, after the editor has rendered
    // measure the new height and take the difference of the height pre-editor render
    // and post-editor render. We'll render the difference in some empty space below
    // the message so layout doesn't shift.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (oldContentContainerHeightForEditorHeightDifference === null) return;

        const contentContainerElement = assertExists(contentContainerRef.current);
        const editorHeightSpacerElement = assertExists(editorHeightSpacerRef.current);

        // Don't change the spacer height once it's been set the first time.
        if (editorHeightSpacerElement.hasAttribute("style")) return;

        const oldContentContainerHeight = oldContentContainerHeightForEditorHeightDifference;
        const newContentContainerHeight = contentContainerElement.offsetHeight;

        const editorHeightDifference = Math.max(
            0,
            oldContentContainerHeight - newContentContainerHeight,
        );

        // Directly set the `style` attribute in this effect so we don't need a React
        // re-render.
        editorHeightSpacerElement.setAttribute("style", `height: ${editorHeightDifference}px`);
    }, [oldContentContainerHeightForEditorHeightDifference]);

    // IMPORTANT(calebmer): Be careful about what you put in this component!
    // `<MessageView>` needs to render fast for us to get good FPS when scrolling
    // through messages. We've directly observed slow hook implementations or too many
    // sub-components slowing down FPS. (Reason why we don't allow `<Box>` in this
    // file.) Before adding new logic to this render function, consider whether you
    // could add it to a child component. Or inline some of the logic.

    return (
        <>
            {timestampDividerNode}
            <ContextMenuActions
                isDisabled={isEditingThisMessage}
                actions={events.getContextMenuActions}
                // Merge the text copy action into the "Copy link" section.
                mergeReadonlyCopyAction={(actionSections, copyTextAction) => {
                    const copyLinkActionSectionIndex = actionSections.findIndex(actionSection =>
                        ("actions" in actionSection ? actionSection.actions : actionSection).some(
                            action =>
                                !action.withCustomLayout &&
                                action.label.startsWith("Copy ") &&
                                action.label.endsWith(" link"),
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
                extraOverlayBottom={event => {
                    // If the user right clicked on a `<ReactionButton>` in the message then only show
                    // the reaction button's context menu actions. Don't show the message context menu
                    // actions.
                    if (hasContextMenuActionWithKey(event, reactionButtonContextMenuActionKey)) {
                        return;
                    }

                    return (
                        <MessageViewMenuStateUpdatedTime
                            createdTime={message.createdTime}
                            // Only show the updated time if the user can't hover over the "(edited)" text to
                            // see it.
                            contentUpdatedTime={
                                !canPrimaryInputHover && message.payload.type === "Content"
                                    ? (message.payload.contentUpdate?.time ?? null)
                                    : null
                            }
                            deletedTime={
                                !canPrimaryInputHover && message.payload.type === "Deleted"
                                    ? message.payload.deletedTime
                                    : null
                            }
                        />
                    );
                }}
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
                                    // NOTE(calebmer): If the user is editing a message we render `<MessageViewEditor>`
                                    // which renders `<InlineEditorToolbar>` which needs to render on top of
                                    // `<MessageViewParent>`.
                                    //
                                    // Fixes:
                                    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/cwvja89b8vmbajqytsa3926h00
                                    message.payload.type === "Content" && isEditingThisMessage
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
                                className={sprinkles({flexGrow: "1", minWidth: "flex-fit"})}
                                style={{
                                    ...(isMessageHighlightedFromContextMenu
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
                                            // Make sure the `z-index` is higher than our content so the `<IconButton>` can but
                                            // clicked even where it overlaps with content.
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
                                                        // NOTE(calebmer): I think we can use "click" in copy here since the description is
                                                        // part of a tooltip which is fundamentally a mouse/pointer thing. On mobile we
                                                        // need to pop open a modal or alert or something.
                                                        description={`Couldn\u2019t ${
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
                                    !isEditingThisMessage ? (
                                        (contentPayloadNode ?? streamNode)
                                    ) : (
                                        <>
                                            <MessageViewEditor
                                                ref={messageEditorRef}
                                                messageStartOfSentenceNoun={
                                                    messageStartOfSentenceNoun
                                                }
                                                isLastMessage={isLastMessage}
                                                shouldMergeWithPreviousMessage={
                                                    shouldMergeWithPreviousMessage
                                                }
                                                messageEditing={messageEditing}
                                            />
                                            <div ref={editorHeightSpacerRef} />
                                        </>
                                    )
                                ) : (
                                    deletedPayloadNode
                                )}
                                {message.payload.type === "Content" &&
                                    message.payload.files.length > 0 && (
                                        <>
                                            <MessageViewFiles
                                                attachmentTarget={fileAttachmentTarget}
                                                files={message.payload.files}
                                                paddingTop={
                                                    contentPayloadNode !== null
                                                        ? // It feels like too much space when we have a single line of text over a file. So
                                                          // special case a single non-standalone margin node above a file and in this case
                                                          // use paragraph margins instead of standalone block margins.
                                                          message.payload.content.doc.childCount ===
                                                              1 &&
                                                          !hasStandaloneMarginByContentBlockNodeTypeName[
                                                              message.payload.content.doc
                                                                  .firstChild!.type.name
                                                          ]
                                                            ? contentStyles.paragraphMargin
                                                            : message.payload.content.doc.lastChild!
                                                                    .type.name === "divider"
                                                              ? contentStyles.messageDividerMargin
                                                              : contentStyles.standaloneBlockMargin
                                                        : undefined
                                                }
                                            />
                                            {(message.payload.filesReactions.get().size > 0 ||
                                                // If this is the last message and the message is from a user other than our own
                                                // then we want to render the party even if there are no reactions so you can leave
                                                // a quick reaction.
                                                (!isReadOnly &&
                                                    isLastMessage &&
                                                    message.author.id !== currentAccountId)) && (
                                                <div className={sprinkles({marginTop: "2"})}>
                                                    <ContentViewReactionParty
                                                        pos="Files"
                                                        reactions={message.payload.filesReactions}
                                                        isReadOnly={isReadOnly}
                                                        onSetReaction={handleSetReaction}
                                                        onDeleteReaction={handleDeleteReaction}
                                                        onPressSeeReactions={async () => {
                                                            if (message.isOptimistic) return;
                                                            if (!currentAccountId) return;

                                                            await navigate(
                                                                message.getSeeReactionsUrl(
                                                                    space.id,
                                                                    message.payload.contentUpdate
                                                                        ?.mappings.length ?? 0,
                                                                    "Files",
                                                                ),
                                                            );
                                                        }}
                                                        randomSeed={
                                                            message.isOptimistic
                                                                ? `MessageViewFiles:optimistic`
                                                                : `MessageViewFiles:${message.getRoomKey()}-${
                                                                      message.index
                                                                  }`
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </>
                                    )}
                            </div>
                            {isMessageHighlightedFromContextMenu && (
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
                                        // If this is one line of text then the background should extend below the avatar.
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
                                inboxContext={inboxContext}
                                onSetMessageReaction={onSetMessageReaction}
                                onDeleteMessageReaction={onDeleteMessageReaction}
                                onUpdateMessagesOptimistically={onUpdateMessagesOptimistically}
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
    parent,
    onJumpToMessageRange,
    onJumpToPostRange,
}: {
    parentMessageRef: RefObject<HTMLDivElement>;
    messageNoun: string;
    parent: MessageContentPayloadParentWithMessages<RoomKey, Message>;
    onJumpToMessageRange: Memo<(options: JumpToMessageRangeOptions<RoomKey>) => void>;
    onJumpToPostRange: Memo<(options: JumpToPostRangeOptions) => void> | undefined;
}) {
    const spacingScale = useSpacingScale();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();

    const {author, truncatedContent} = useStore(
        useMemo(() => {
            return computeStore(get => {
                switch (parent.type) {
                    case "Message": {
                        return {
                            author: get(accountRegistry.getAccountStore(parent.message.author)),
                            truncatedContent: getTruncatedMessageContentForReplyPreview(get, {
                                message: parent.message,
                                messageNoun,
                                accountRegistry,
                                searchEntityRegistry,
                                fileRegistry,
                            }),
                        };
                    }
                    case "MessagesRange": {
                        return {
                            author: get(accountRegistry.getAccountStore(parent.messages[0].author)),
                            truncatedContent: getTruncatedMessagesRangeContentForReplyPreview(get, {
                                messages: parent.messages,
                                startContentVersion: parent.startContentVersion,
                                startPos: parent.startPos,
                                endContentVersion: parent.endContentVersion,
                                endPos: parent.endPos,
                                messageNoun,
                                accountRegistry,
                                searchEntityRegistry,
                                fileRegistry,
                            }),
                        };
                    }
                    case "PostRange": {
                        return {
                            author: get(accountRegistry.getAccountStore(parent.post.author)),
                            truncatedContent: getTruncatedPostContentForReplyPreview(get, {
                                post: parent.post,
                                contentVersion: parent.contentVersion,
                                startPos: parent.startPos,
                                endPos: parent.endPos,
                                accountRegistry,
                                searchEntityRegistry,
                                fileRegistry,
                            }),
                        };
                    }
                    default:
                        throw exhaustive(parent);
                }
            });
        }, [accountRegistry, fileRegistry, messageNoun, parent, searchEntityRegistry]),
    );

    const accountAvatarSizeRem = parseRemLength(messageViewAccountAvatarSize);
    const parentMessageOffsetRem = parseRemLength(messageViewRailGap) / 2;
    const parentMessageAccountAvatarSizeRem = parseRemLength(messageViewParentAccountAvatarSize);

    assert(
        parent.type !== "PostRange" || onJumpToPostRange !== undefined,
        "If the parent is `PostRange` then `onJumpToPostRange` must be provided",
    );

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            switch (parent.type) {
                case "Message": {
                    onJumpToMessageRange({
                        roomKey: parent.message.getRoomKey(),
                        startIndex: parent.message.index,
                        endIndex: parent.message.index,
                        start: null,
                        end: null,
                    });
                    break;
                }
                case "MessagesRange": {
                    onJumpToMessageRange({
                        roomKey: parent.messages[0].getRoomKey(),
                        startIndex: parent.startIndex,
                        endIndex: parent.endIndex,
                        start: {contentVersion: parent.startContentVersion, pos: parent.startPos},
                        end: {contentVersion: parent.endContentVersion, pos: parent.endPos},
                    });
                    break;
                }
                case "PostRange": {
                    assertExists(onJumpToPostRange)({
                        postId: parent.post.id,
                        contentVersion: parent.contentVersion,
                        startPos: parent.startPos,
                        endPos: parent.endPos,
                    });
                    break;
                }
                default:
                    throw exhaustive(parent);
            }
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
                // This is a simulated link. When the user clicks on it our code navigates us to
                // the right message instead of relying on browser URL navigation.
                //
                // See:
                // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                role="link"
                tabIndex={0}
                className={sprinkles({
                    position: "relative",
                    zIndex: "10",
                    // `inline-flex` instead of `flex` so that the clickable area doesn't extend full
                    // width when we have a short message.
                    display: "inline-flex",
                    gap: "1.5",
                    marginTop: messageViewParentMarginTop,
                    marginBottom: messageViewParentMarginBottom,
                    // We don't use a pointer cursor for buttons in our product because buttons they
                    // clearly appear clickable. We call this a strong affordance. A reply preview is
                    // clickable and gives some affordance (different color) but it's a weak
                    // affordance. So we use a pointer to make this element unambiguously clickable.
                    //
                    // Also, this element is semantically a link which the pointer cursor was
                    // originally designed for.
                    //
                    // See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
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

                        // Remember this code is copied here and in `message_view_html.ts`. If you update
                        // one you probably need to update the other as well.
                        top: `calc(${
                            messageViewParentAvatarOffsetYRem +
                            parentMessageAccountAvatarSizeRem / 2
                        }rem - 1px)`,
                        bottom: `calc(-${spacing[messageViewParentMarginBottom]} - ${
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
                    <AccountAvatar size={messageViewParentAccountAvatarSize} account={author} />
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
                        // eslint-disable-next-line cyberworlds/string-quotes
                        fontFeatureSettings: '"calt" on',
                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: messageViewParentLineClamp,
                        lineClamp: messageViewParentLineClamp,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                    }}
                >
                    <AccountShortName account={author} />: {truncatedContent}
                </div>
            </div>
        </FocusRing>
    );
}
