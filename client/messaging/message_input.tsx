import {setInteractionModality, useInteractionModality} from "@react-aria/interactions";
import {ArrowArcLeft, ArrowUp, X} from "phosphor-react";
import {MutableRefObject, useEffect, useId, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useShowToast} from "~/client/design/toast.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useInboxPeekContext} from "~/client/inbox/inbox_peek_context.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {
    defaultMessageViewMarginX,
    getMessageBubbleMarginLeft,
    getTruncatedMessageContentForReplyPreview,
    messageViewPreviewScale,
    messageViewReplyPreviewBubbleOpacity,
    messageViewReplyPreviewOpacity,
} from "~/client/messaging/message_view.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {
    MessageContent,
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    messageInputMinHeight,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
} from "~/shared/messaging/messaging_shared_styles.js";
import {colorSchemeVars, contentViewStyles, sprinkles} from "~/shared/styles/styles.js";

const accountAvatarSize: Spacing = "7";
const accountAvatarPaddingY: RemLength = `${
    (parseRemLengthNumber(messageViewBubbleMinHeight) -
        parseRemLengthNumber(spacing[accountAvatarSize])) /
    2
}rem`;

export function MessageInput<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    messages,
    isMessageCreationDisabled,
    onUpdateMessages,
    createMessage,
    messageEditing,
    replyingToMessage: _replyingToMessage,
    onClearReplyingToMessage,
    onJumpToMessage,
    onShowTypingIndicator,
    onHideTypingIndicator,
    withoutBorderTop = false,
    "data-testid": dataTestId,
    restoreStateRef,
    marginX = defaultMessageViewMarginX,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    messages: MessageList<Message>;
    isMessageCreationDisabled?: boolean;
    onUpdateMessages: (update: (messages: MessageList<Message>) => MessageList<Message>) => void;
    createMessage: (input: {
        parentMessageIndex: number | null;
        content: MessageContent;
    }) => Promise<void>;
    messageEditing: MessageEditing<RoomKey>;
    replyingToMessage: Message | null;
    onClearReplyingToMessage: () => void;
    onJumpToMessage: (message: Message) => void;
    onShowTypingIndicator: () => void;
    onHideTypingIndicator: () => void;
    withoutBorderTop?: boolean;
    "data-testid"?: string;
    restoreStateRef?: MutableRefObject<{
        state: ContentEditorState<MessageContentWithReferences>;
        isFocused: boolean;
    } | null>;
    marginX?: Spacing;
}) {
    const clientInfo = useClientInfo();
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();
    const inboxPeekContext = useInboxPeekContext();
    const editorRef = useRef<ContentEditorRef>(null);
    const [state, setState] = useState(
        () =>
            restoreStateRef?.current?.state ??
            ContentEditorState.create(emptyMessageContentWithReferences),
    );

    const hasInitiallyMountedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        const isInitialMount = !hasInitiallyMountedRef.current;
        hasInitiallyMountedRef.current = true;

        if (!restoreStateRef) return;

        const editor = assertExists(editorRef.current);

        // If we are restoring a message input that was focused then refocus it.
        if (isInitialMount && restoreStateRef.current?.isFocused) {
            editor.focus();
        }

        restoreStateRef.current = {
            state,
            isFocused: restoreStateRef.current?.isFocused ?? editor.isFocused() ?? false,
        };
    });

    const replyingToMessage = useMemo(() => {
        if (!_replyingToMessage) return null;

        return {
            message: _replyingToMessage,
            truncatedContent: getTruncatedMessageContentForReplyPreview({
                message: _replyingToMessage,
                messageStartOfSentenceNoun,
            }),
        };
    }, [_replyingToMessage, messageStartOfSentenceNoun]);

    // Focus the message input whenever the message we're replying to changes.
    const replyingToMessageIndex = replyingToMessage?.message.index ?? null;
    useEffect(() => {
        if (replyingToMessageIndex === null) return;
        const editor = assertExists(editorRef.current);
        editor.focus();
    }, [replyingToMessageIndex]);

    const submitMessage = () => {
        if (isMessageCreationDisabled) return;

        const content = state.getContent();
        if (isContentEmpty(content.doc)) return;

        const optimisticMessage: OptimisticMessageModel = {
            isOptimistic: true,
            optimisticId: generateId(),
            optimisticRequestErrorState: {hasError: false},
            author: currentAccount,
            createdTime: new Date(),
            payload: {
                type: "Content",
                parentMessageIndex: replyingToMessage?.message.index ?? null,
                content,
                contentUpdatedTime: null,
            },
        };

        onUpdateMessages(messages => messages.addOptimisticMessage(optimisticMessage));

        setState(ContentEditorState.create(emptyMessageContentWithReferences));
        onClearReplyingToMessage();

        const tryCreatingMessage = () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    // Creating a message in our realtime messaging server should also clear this
                    // connection's typing state atomically.
                    if (typingIndicatorStateRef.current.shouldBeShowing) {
                        typingIndicatorStateRef.current.timeout.clear();
                        typingIndicatorStateRef.current = {shouldBeShowing: false};
                    }

                    // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                    // close the page if we haven't finished sending their message. It will
                    // look ok on their machine but might not be on the server.
                    const promise = createMessage({
                        parentMessageIndex: replyingToMessage?.message.index ?? null,
                        content: content.doc,
                    });

                    // Sending a message dismisses post comment entries and chat entries.
                    // Optimistically archive these entries so we don't need to wait for
                    // realtime. The latency of which may be long since notification events are
                    // processed by a queue.
                    inboxPeekContext?.onCreateMessageOptimistically(promise);

                    await promise;

                    // We wait to receive the new message over realtime to confirm the optimistic
                    // message. We do this so that messages are delivered to the user in order
                    // instead of confirming a message and discovering some unloaded messages.
                } catch (error) {
                    showToast({
                        type: "Error",
                        title: `Couldn’t create ${messageNoun}`,
                        error,
                    });

                    onUpdateMessages(messages =>
                        messages.updateOptimisticMessage(
                            optimisticMessage.optimisticId,
                            optimisticMessage => ({
                                ...optimisticMessage,
                                optimisticRequestErrorState: {
                                    hasError: true,
                                    retry: () => {
                                        // Clear the error when we are retrying then call this
                                        // function again.
                                        onUpdateMessages(messages =>
                                            messages.updateOptimisticMessage(
                                                optimisticMessage.optimisticId,
                                                optimisticMessage => ({
                                                    ...optimisticMessage,
                                                    optimisticRequestErrorState: {
                                                        hasError: false,
                                                    },
                                                }),
                                            ),
                                        );

                                        tryCreatingMessage();
                                    },
                                },
                            }),
                        ),
                    );
                }
            });
        };

        tryCreatingMessage();
    };

    const interactionModality = useInteractionModality();
    const isSendButtonDisabled = isMessageCreationDisabled || isContentEmpty(state.getDoc());

    const typingIndicatorStateRef = useRef<
        {shouldBeShowing: true; timeout: Timeout} | {shouldBeShowing: false}
    >({shouldBeShowing: false});

    const showTypingIndicator = () => {
        const typingIndicatorTimeout = 5000;

        const shouldAlreadyByShowing = typingIndicatorStateRef.current.shouldBeShowing;
        if (shouldAlreadyByShowing) typingIndicatorStateRef.current.timeout.clear();

        typingIndicatorStateRef.current = {
            shouldBeShowing: true,
            timeout: createTimeout(hideTypingIndicator, typingIndicatorTimeout),
        };

        if (!shouldAlreadyByShowing) onShowTypingIndicator();
    };

    // NOTE(calebmer): We don't call `hideTypingIndicator()` after sending a
    // message. Our messaging realtime backend should automatically atomically hide
    // the typing indicator when the client creates a message.
    const hideTypingIndicator = useEvent(() => {
        if (typingIndicatorStateRef.current.shouldBeShowing) {
            typingIndicatorStateRef.current.timeout.clear();
            typingIndicatorStateRef.current = {shouldBeShowing: false};
            onHideTypingIndicator();
        }
    });

    // Hide our typing indicator if this component unmounts.
    useEffect(() => {
        return () => {
            hideTypingIndicator();
        };
    }, [hideTypingIndicator]);

    const id = useId();

    return (
        <Box
            data-testid={dataTestId}
            id={clientInfo.isNativeMobile ? `NativeMobileBottomBar-${id}` : id}
            flexShrink="0"
            backgroundColor="grey-0"
            borderTop={!withoutBorderTop ? "grey-10" : undefined}
            style={{
                // Remove one pixel so that our layout of the input without the border top is
                // the same side-by-side with the layout of an input with the border top.
                minHeight: withoutBorderTop
                    ? `calc(${messageInputMinHeight} - 1px + var(--window-safe-area-inset-bottom, 0px))`
                    : `calc(${messageInputMinHeight} + var(--window-safe-area-inset-bottom, 0px))`,
                // Remove one pixel from top to make space for a border.
                paddingTop: `calc(${spacing["3"]} - 1px)`,
                paddingBottom: `calc(${spacing["3"]} + var(--window-safe-area-inset-bottom, 0px))`,
                // Our native mobile wrapper looks for compositing layers created from an
                // element with an ID that starts with `NativeMobileBottomBar-` and ties their
                // position to the tab bar and software keyboard. So we get smooth animations
                // while the keyboard opens or the tab bar shifts offscreen. To create a
                // compositing layer we need to set `will-change: transform`. It's not
                // specified that `will-change: transform` MUST create a compositing layer,
                // instead some browser engines implement this hint themselves as an
                // optimization.
                //
                // It so happens that WebKit is one of those browsers. Here's the code in
                // WebKit that does this: [part 1][1], [part 2][2].
                //
                // We can't set `transform` on a native mobile bottom bar element since native
                // code will be setting the `transform` property as the bottom bar moves.
                //
                // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                // [2]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                willChange: clientInfo.isNativeMobile ? "transform" : undefined,
            }}
            // Suppress React hydration warnings in our native mobile app. The native
            // mobile app sets the `transform` property on this element. Sometimes before
            // React finishes hydrating. This is expected, React can ignore the difference.
            suppressHydrationWarning={clientInfo.isNativeMobile ? true : undefined}
        >
            {replyingToMessage &&
                (() => {
                    const height = addRemLengths(
                        spacing["1.5"],
                        contentViewStyles.truncatedHeight,
                        spacing["1.5"],
                    );

                    const scaledHeight = `${
                        Math.round(parseRemLengthNumber(height) * messageViewPreviewScale * 16) / 16
                    }rem`;

                    return (
                        <Box
                            position="relative"
                            paddingBottom="3"
                            style={{
                                paddingLeft: getMessageBubbleMarginLeft(marginX),
                                paddingRight: addRemLengths(
                                    spacing["2"],
                                    spacing["7"],
                                    spacing["5"],
                                ),
                            }}
                        >
                            <Box
                                paddingLeft="1.5"
                                paddingBottom="1"
                                display="flex"
                                alignItems="center"
                                gap="0.5"
                                fontSize="50"
                                fontStyle="truncate"
                            >
                                <ArrowArcLeft size={spacing["3"]} />
                                <span>
                                    Replying to{" "}
                                    <span className={sprinkles({fontStyle: "bold"})}>
                                        <AccountShortName
                                            account={replyingToMessage.message.author}
                                        />
                                    </span>
                                </span>
                            </Box>
                            <Box style={{height: scaledHeight}}>
                                <FocusRing>
                                    <Box
                                        // This is a simulated link. When the user clicks on it our code navigates us
                                        // to the right message instead of relying on browser URL navigation.
                                        //
                                        // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                                        role="link"
                                        tabIndex={0}
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
                                        cursor="pointer"
                                        position="relative"
                                        zIndex="0"
                                        display="inline-block"
                                        maxWidth="full"
                                        paddingX={messageViewBubblePaddingX}
                                        paddingY={messageViewBubblePaddingY}
                                        borderRadius={messageViewBubbleBorderRadius}
                                        style={{
                                            opacity: messageViewReplyPreviewOpacity,
                                            transform: `scale(${messageViewPreviewScale})`,
                                            transformOrigin: "0% 0% 0",
                                        }}
                                        onClick={() => onJumpToMessage(replyingToMessage.message)}
                                        onKeyDown={event => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onJumpToMessage(replyingToMessage.message);
                                                return;
                                            }
                                        }}
                                    >
                                        <Box
                                            position="absolute"
                                            inset="0"
                                            zIndex="-10"
                                            borderRadius={messageViewBubbleBorderRadius}
                                            backgroundColor="grey-5"
                                            style={{opacity: messageViewReplyPreviewBubbleOpacity}}
                                        />
                                        <Box overflow="hidden" pointerEvents="none">
                                            <ContentView
                                                isInert={true}
                                                isTruncated={true}
                                                content={replyingToMessage.truncatedContent}
                                            />
                                        </Box>
                                    </Box>
                                </FocusRing>
                            </Box>
                            <Box position="absolute" top="0" right="5">
                                <IconButton
                                    size="xs"
                                    description="Cancel reply"
                                    withoutTooltip={true}
                                    onPress={onClearReplyingToMessage}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </Box>
                    );
                })()}
            <Box overflow="hidden" display="flex" paddingX={marginX}>
                <Box display="flex" alignItems="flex-end">
                    <Box
                        style={{
                            paddingTop: accountAvatarPaddingY,
                            paddingBottom: accountAvatarPaddingY,
                        }}
                    >
                        <AccountAvatar account={currentAccount} size={accountAvatarSize} />
                    </Box>
                </Box>
                <FocusRing isVisibleWhenFocusWithin={true}>
                    <Box
                        flexGrow="1"
                        overflow="hidden"
                        marginX="2"
                        backgroundColor="grey-5"
                        borderRadius={messageViewBubbleBorderRadius}
                        style={{
                            minHeight: messageViewBubbleMinHeight,
                            // Use `box-shadow` for border to not contribute to the element's size.
                            //
                            // NOTE(calebmer, 2023-11-27): Added this border to the message input since the
                            // background alone made the input look too much like any other comment. The
                            // border helps it stand out more, gives it visual importance. I want to keep
                            // the background so the appearance of the message input accurately reflects a
                            // message bubble. Let's make this change and see how I feel using it.
                            boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                        }}
                    >
                        <Box
                            ref={useScrollbar({
                                insetY: spacing["1.5"],
                                insetRight: spacing["0.5"],
                            })}
                            maxHeight="96"
                            position="relative"
                            overflowX="hidden"
                            overflowY="auto"
                        >
                            <ContentEditor
                                ref={editorRef}
                                state={state}
                                onChange={(state, transaction) => {
                                    setState(state);
                                    if (transaction.docChanged) showTypingIndicator();
                                }}
                                onFocus={() => {
                                    if (restoreStateRef?.current)
                                        restoreStateRef.current.isFocused = true;
                                }}
                                onBlur={() => {
                                    if (restoreStateRef?.current)
                                        restoreStateRef.current.isFocused = false;

                                    hideTypingIndicator();
                                }}
                                aria-label={`New ${messageNoun}`}
                                placeholder={`Write a ${messageNoun}`}
                                className={sprinkles({
                                    paddingX: messageViewBubblePaddingX,
                                    paddingY: messageViewBubblePaddingY,
                                })}
                                onEnterFromPhysicalKeyboard={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    submitMessage();
                                }}
                                onArrowUp={event => {
                                    if (isContentEmpty(state.getDoc())) {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        // Look at the last 10 messages. Start editing state for the last one our
                                        // account authored.
                                        for (const message of sliceIterable(
                                            messages.iterateLoadedMessagesFromEnd(),
                                            0,
                                            10,
                                        )) {
                                            if (
                                                message.author.id === currentAccount.id &&
                                                message.payload.type === "Content"
                                            ) {
                                                const previousInteractionModality =
                                                    interactionModality;

                                                messageEditing.dispatch({
                                                    type: "StartEditing",
                                                    messageRoomKey: message.getRoomKey(),
                                                    messageIndex: message.index,
                                                    messagePayload: message.payload,
                                                    returnFocusAfterEditing: () => {
                                                        // Reset the interaction modality when returning focus to our editor. So if the
                                                        // user pressed enter to save that doesn't give us a keyboard modality if the
                                                        // user wasn't using keyboard navigation before.
                                                        setInteractionModality(
                                                            previousInteractionModality,
                                                        );

                                                        editorRef.current?.focus();
                                                    },
                                                });
                                                break;
                                            }
                                        }
                                    }
                                }}
                            />
                        </Box>
                    </Box>
                </FocusRing>
                <Box display="flex" alignItems="flex-end">
                    <Box
                        style={{
                            paddingTop: accountAvatarPaddingY,
                            paddingBottom: accountAvatarPaddingY,
                        }}
                    >
                        <IconButton
                            variant="accent"
                            description={`Send ${messageNoun}`}
                            isDisabled={isSendButtonDisabled}
                            onPress={submitMessage}
                            // The send icon button is not focusable. That's because we don't want to
                            // remove focus from the message input when the send button is pressed. That
                            // way on mobile you can keep typing and sending messages because the software
                            // keyboard doesn't disappear.
                            //
                            // On desktop, hitting enter in the message input is sufficient for keyboard
                            // control of the message input.
                            isFocusable={false}
                        >
                            <ArrowUp
                                size={spacing["4"]}
                                weight={!isSendButtonDisabled ? "bold" : undefined}
                            />
                        </IconButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
