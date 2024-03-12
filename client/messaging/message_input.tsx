import {setInteractionModality, useInteractionModality} from "@react-aria/interactions";
import {animate} from "motion";
import {ArrowArcLeft, ArrowRight, ArrowUp, X} from "phosphor-react";
import {MutableRefObject, RefObject, useEffect, useId, useMemo, useRef, useState} from "react";
import {useIsInertNativeMobileRoute} from "~/app/router/native_mobile_outlet.js";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {MessageInputMobileKeyboardToolbar} from "~/client/content/message_input_mobile_keyboard_toolbar.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/design/mobile_bottom_bar.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useShowToast} from "~/client/design/toast.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/helpers/use_resize_observer.js";
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
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {
    isMobileBottomBarFrameChangeEnabled,
    registerMobileBottomBarFrame,
} from "~/client/remix/subscribe_to_mobile_bottom_bar_frame_change.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
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
    messageStartOfSentenceNoun,
    placeholder,
    messages,
    isMessageCreationDisabled,
    onUpdateMessages,
    createMessage,
    messageEditing,
    replyingToMessage,
    onClearReplyingToMessage,
    onJumpToMessage,
    onShowTypingIndicator,
    onHideTypingIndicator,
    "data-testid": dataTestId,
    restoreStateRef,
    marginX = defaultMessageViewMarginX,
    withMobileLayout,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    placeholder?: string;
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
    "data-testid"?: string;
    restoreStateRef?: MutableRefObject<{
        state: ContentEditorState<MessageContentWithReferences>;
        isFocused: boolean;
    } | null>;
    marginX?: Spacing;
    withMobileLayout?: boolean;
}) {
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();
    const inboxPeekContext = useInboxPeekContext();
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
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
                parentMessageIndex: replyingToMessage?.index ?? null,
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
                    // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                    // close the page if we haven't finished sending their message. It will
                    // look ok on their machine but might not be on the server.
                    const promise = createMessage({
                        parentMessageIndex: replyingToMessage?.index ?? null,
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

    return (
        <MessageInputBase
            editorRef={editorRef}
            messageNoun={messageNoun}
            messageStartOfSentenceNoun={messageStartOfSentenceNoun}
            placeholder={placeholder}
            state={state}
            onChange={setState}
            onSend={submitMessage}
            isSendButtonDisabled={isMessageCreationDisabled}
            replyingToMessage={replyingToMessage}
            onClearReplyingToMessage={onClearReplyingToMessage}
            onJumpToMessage={onJumpToMessage}
            onShowTypingIndicator={onShowTypingIndicator}
            onHideTypingIndicator={onHideTypingIndicator}
            isBottomBar={true}
            data-testid={dataTestId}
            marginX={marginX}
            withMobileLayout={withMobileLayout}
            onFocus={() => {
                if (restoreStateRef?.current) restoreStateRef.current.isFocused = true;
            }}
            onBlur={() => {
                if (restoreStateRef?.current) restoreStateRef.current.isFocused = false;
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
                            const previousInteractionModality = interactionModality;

                            messageEditing.dispatch({
                                type: "StartEditing",
                                messageRoomKey: message.getRoomKey(),
                                messageIndex: message.index,
                                messagePayload: message.payload,
                                returnFocusAfterEditing: () => {
                                    // Reset the interaction modality when returning focus to our editor. So if the
                                    // user pressed enter to save that doesn't give us a keyboard modality if the
                                    // user wasn't using keyboard navigation before.
                                    setInteractionModality(previousInteractionModality);

                                    editorRef.current?.focus();
                                },
                            });
                            break;
                        }
                    }
                }
            }}
        />
    );
}

export function MessageInputBase<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    editorRef: externalEditorRef,
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    placeholder = `${messageNoun === "message" ? "Send" : "Add"} a ${messageNoun}`,
    state,
    onChange,
    onSend: onSendProp,
    isBottomBar = false,
    withMobileLayout: withMobileLayoutProp,
    isSendBottomArrowRight,
    isSendButtonDisabled: isSendButtonDisabledProp,
    isSendButtonPending,
    replyingToMessage: replyingToMessageProp,
    onClearReplyingToMessage,
    onJumpToMessage,
    onShowTypingIndicator,
    onHideTypingIndicator,
    "data-testid": dataTestId,
    marginX = defaultMessageViewMarginX,
    onFocus,
    onBlur,
    onArrowUp,
}: {
    editorRef?: RefObject<ContentEditorRef<MessageContentWithReferences>>;
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    placeholder?: string;
    state: ContentEditorState<MessageContentWithReferences>;
    onChange: (state: ContentEditorState<MessageContentWithReferences>) => void;
    onSend: () => void;
    isBottomBar?: boolean;
    withMobileLayout?: boolean;
    isSendBottomArrowRight?: boolean;
    isSendButtonDisabled?: boolean;
    isSendButtonPending?: boolean;
    replyingToMessage?: Message | null;
    onClearReplyingToMessage?: () => void;
    onJumpToMessage?: (message: Message) => void;
    onShowTypingIndicator?: () => void;
    onHideTypingIndicator?: () => void;
    "data-testid"?: string;
    marginX?: Spacing;
    onFocus?: () => void;
    onBlur?: () => void;
    onArrowUp?: (event: KeyboardEvent) => void;
}) {
    const isMobile = useIsMobile();
    const clientInfo = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const containerRef = useRef<HTMLDivElement>(null);
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const [isKeyboardToolbarVisible, setIsKeyboardToolbarVisible] = useState(false);
    if (isKeyboardToolbarVisible && !(isMobile && isBottomBar)) setIsKeyboardToolbarVisible(false);

    const cancelFocusOrBlurRef = useRef<(() => void) | null>(null);

    const replyingToMessage = useMemo(() => {
        if (!replyingToMessageProp) return null;

        return {
            message: replyingToMessageProp,
            truncatedContent: getTruncatedMessageContentForReplyPreview({
                message: replyingToMessageProp,
                messageStartOfSentenceNoun,
            }),
        };
    }, [replyingToMessageProp, messageStartOfSentenceNoun]);

    // Focus the message input whenever the message we're replying to changes.
    const replyingToMessageIndex = replyingToMessage?.message.index ?? null;
    useEffect(() => {
        if (replyingToMessageIndex === null) return;
        const editor = assertExists(editorRef.current);
        editor.focus();
    }, [replyingToMessageIndex]);

    const isSendButtonDisabled = isSendButtonDisabledProp || isContentEmpty(state.getDoc());

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

        if (!shouldAlreadyByShowing) onShowTypingIndicator?.();
    };

    // NOTE(calebmer): We don't call `hideTypingIndicator()` after sending a
    // message. Our messaging realtime backend should automatically atomically hide
    // the typing indicator when the client creates a message.
    const hideTypingIndicator = useEvent(() => {
        if (typingIndicatorStateRef.current.shouldBeShowing) {
            typingIndicatorStateRef.current.timeout.clear();
            typingIndicatorStateRef.current = {shouldBeShowing: false};
            onHideTypingIndicator?.();
        }
    });

    // Hide our typing indicator if this component unmounts.
    useEffect(() => {
        return () => {
            hideTypingIndicator();
        };
    }, [hideTypingIndicator]);

    const onSend = () => {
        // Creating a message in our realtime messaging server should also clear this
        // connection's typing state atomically.
        if (typingIndicatorStateRef.current.shouldBeShowing) {
            typingIndicatorStateRef.current.timeout.clear();
            typingIndicatorStateRef.current = {shouldBeShowing: false};
        }

        onSendProp();
    };

    const handleFocus = () => {
        cancelFocusOrBlurRef.current?.();
        cancelFocusOrBlurRef.current = null;

        onFocus?.();

        // 1. On mobile, make sure our keyboard toolbar is visible when focused
        // 2. On mobile web, animate so our toolbar is visible. In our native app, the
        //    shell manages animating the toolbar so it's visible
        if (isMobile && isBottomBar) {
            setIsKeyboardToolbarVisible(true);

            if (NativeMobileBridge) {
                // Our native mobile app will animate the keyboard toolbar onscreen.
            } else {
                const containerElement = assertExists(containerRef.current);

                const animation = animate(
                    containerElement,
                    {
                        y: [
                            0,
                            -mobileBottomBarKeyboardToolbarHeightRem * getRemPxWithoutListening(),
                        ],
                    },
                    {
                        duration: 0.2,
                        // Make sure we use hardware acceleration for this animation in WebKit. By
                        // default `motion` turns it off.
                        // https://motion.dev/guides/performance#webkits-exceptions
                        allowWebkitAcceleration: true,
                    },
                );

                const cancel = () => {
                    animation.cancel();
                };

                cancelFocusOrBlurRef.current = cancel;
                animation.finished.finally(() => {
                    if (cancelFocusOrBlurRef.current === cancel)
                        cancelFocusOrBlurRef.current = null;
                });
            }
        }
    };

    const handleBlur = () => {
        cancelFocusOrBlurRef.current?.();
        cancelFocusOrBlurRef.current = null;

        hideTypingIndicator();

        onBlur?.();

        // 1. On mobile, make sure our keyboard toolbar is visible when focused
        // 2. On mobile web, animate so our toolbar is visible. In our native app, the
        //    shell manages animating the toolbar so it's visible
        if (isMobile && isBottomBar) {
            setIsKeyboardToolbarVisible(false);

            if (NativeMobileBridge) {
                // Our native mobile app will animate the keyboard toolbar offscreen. We just
                // need to hide the keyboard toolbar which will be visible in safe areas.
            } else {
                const containerElement = assertExists(containerRef.current);

                const animation = animate(
                    containerElement,
                    {
                        y: [
                            -mobileBottomBarKeyboardToolbarHeightRem * getRemPxWithoutListening(),
                            0,
                        ],
                    },
                    {
                        duration: 0.2,
                        // Make sure we use hardware acceleration for this animation in WebKit. By
                        // default `motion` turns it off.
                        // https://motion.dev/guides/performance#webkits-exceptions
                        allowWebkitAcceleration: true,
                    },
                );

                const cancel = () => {
                    animation.cancel();
                };

                cancelFocusOrBlurRef.current = cancel;
                animation.finished.finally(() => {
                    if (cancelFocusOrBlurRef.current === cancel)
                        cancelFocusOrBlurRef.current = null;
                });
            }
        }
    };

    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useLayoutEffectWithoutServerSideWarning(() => {
        // If `registerMobileBottomBar()` does nothing then don't bother adding resize
        // event listeners.
        if (!isMobileBottomBarFrameChangeEnabled) return;

        if (isInertNativeMobileRoute) return;

        const inputContainerElement = assertExists(inputContainerRef.current);

        let currentHeight: number | null = null;
        let unregister: (() => void) | null = null;

        const handleResize = () => {
            const {height} = inputContainerElement.getBoundingClientRect();

            if (currentHeight !== height) {
                currentHeight = height;

                const oldUnregister = unregister;
                unregister = registerMobileBottomBarFrame(height, {withKeyboardToolbar: true});

                // Make sure to unregister AFTER registering the new height. That way if the
                // height didn't change there will be no update notifications.
                oldUnregister?.();
            }
        };

        // We appear to have no visual issues when this resizes. Mainly adding a
        // resize element listener to this element causes a suppressed warning from
        // `<VirtualizedScrollView>` to be logged.
        addSuppressResizeLoopErrorNotificationForElement(inputContainerElement);

        addResizeListenerForElement(inputContainerElement, handleResize);

        return () => {
            removeResizeListenerForElement(inputContainerElement, handleResize);
            removeSuppressResizeLoopErrorNotificationForElement(inputContainerElement);
            unregister?.();
        };
    }, [isInertNativeMobileRoute]);

    const id = useId();

    // Extra slop that extends beneath the bottom of the message input. This is
    // always cut off on desktop. However, it matters in our native mobile app.
    // When we animate the message input with the keyboard, their translations
    // aren't perfectly in sync (even though the timing is in sync). So there are
    // moments in the animation where the content may be revealed between the
    // message input and the keyboard. To fix this, we just make them message input
    // bigger so it can cover content below while animating. To debug this turn on
    // slow animations in an iOS emulator and open the keyboard.
    const bottomBarBackgroundSlopBottom = spacing["96"];

    return (
        <Box
            ref={containerRef}
            data-testid={dataTestId}
            id={isBottomBar && clientInfo.isNativeMobile ? `nmbb-wkt-${id}` : id}
            flexShrink="0"
            backgroundColor="grey-0"
            style={{
                minHeight: !isBottomBar
                    ? messageInputMinHeight
                    : `calc(${messageInputMinHeight} + var(--window-safe-area-inset-bottom, 0px))`,
                paddingBottom: isBottomBar
                    ? clientInfo.isNativeMobile
                        ? `calc(${bottomBarBackgroundSlopBottom} + var(--window-safe-area-inset-bottom, 0px))`
                        : "var(--window-safe-area-inset-bottom, 0px)"
                    : undefined,
                marginBottom:
                    isBottomBar && clientInfo.isNativeMobile
                        ? `-${addRemLengths(
                              bottomBarBackgroundSlopBottom,
                              spacing[mobileBottomBarKeyboardToolbarHeight],
                          )}`
                        : isBottomBar && isMobile
                        ? `-${spacing[mobileBottomBarKeyboardToolbarHeight]}`
                        : undefined,
                // Our native mobile wrapper looks for compositing layers created from an
                // element with an ID that starts with `nmbb-` and ties their position to
                // the tab bar and software keyboard. So we get smooth animations while the
                // keyboard opens or the tab bar shifts offscreen. To create a compositing
                // layer we need to set `will-change: transform`. It's not specified that
                // `will-change: transform` MUST create a compositing layer, instead some
                // browser engines implement this hint themselves as an optimization.
                //
                // It so happens that WebKit is one of those browsers. Here's the code in
                // WebKit that does this: [part 1][1], [part 2][2].
                //
                // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                // [2]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                willChange: isBottomBar && clientInfo.isNativeMobile ? "transform" : undefined,
                // Set `transform` to its initial value assuming the tab bar is up.
                transform:
                    isBottomBar && clientInfo.isNativeMobile
                        ? "translateY(calc(var(--window-safe-area-inset-bottom, 0px) - var(--safe-area-inset-bottom, 0px)))"
                        : undefined,
            }}
            // Suppress React hydration warnings in our native mobile app. The native
            // mobile app sets the `transform` property on this element. Sometimes before
            // React finishes hydrating. This is expected, React can ignore the difference.
            suppressHydrationWarning={isBottomBar && clientInfo.isNativeMobile ? true : undefined}
            onPointerDownCapture={event => {
                const editor = assertExists(editorRef.current);

                // Tapping anywhere on the message input shouldn't unfocus the content editor
                // since that will hide the virtual keyboard on mobile.
                if (
                    event.target instanceof Element &&
                    // Exclude tapping in a portaled element. Like inputs in the link modal.
                    event.currentTarget.contains(event.target) &&
                    // Exclude tapping in the message input itself. Tapping there should do
                    // something.
                    !editor.contains(event.target)
                ) {
                    event.preventDefault();
                }
            }}
        >
            <Box
                ref={inputContainerRef}
                width="full"
                maxWidth="160"
                paddingBottom="3"
                style={{
                    // Remove one pixel from top to make space for a border.
                    paddingTop: !isBottomBar ? spacing["3"] : `calc(${spacing["3"]} - 1px)`,
                    margin: "0 auto",
                }}
            >
                {replyingToMessage &&
                    (() => {
                        const height = addRemLengths(
                            spacing["1.5"],
                            contentViewStyles.truncatedHeight,
                            spacing["1.5"],
                        );

                        const scaledHeight = `${
                            Math.round(
                                parseRemLengthNumber(height) * messageViewPreviewScale * 16,
                            ) / 16
                        }rem`;

                        return (
                            <Box
                                position="relative"
                                paddingBottom="4"
                                style={{
                                    paddingLeft: withMobileLayout
                                        ? spacing["3"]
                                        : getMessageBubbleMarginLeft(marginX),
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
                                            onClick={() =>
                                                onJumpToMessage?.(replyingToMessage.message)
                                            }
                                            onKeyDown={event => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    onJumpToMessage?.(replyingToMessage.message);
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
                                                style={{
                                                    opacity: messageViewReplyPreviewBubbleOpacity,
                                                }}
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
                                <Box position="absolute" top="0" right="3">
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
                <Box
                    overflow="hidden"
                    display="flex"
                    paddingX={withMobileLayout ? "3" : marginX}
                    gap="2"
                >
                    {!withMobileLayout && (
                        <Box display="flex" alignItems="flex-end">
                            <Box
                                width={accountAvatarSize}
                                style={{
                                    paddingTop: accountAvatarPaddingY,
                                    paddingBottom: accountAvatarPaddingY,
                                }}
                            >
                                <AccountAvatar account={currentAccount} size={accountAvatarSize} />
                            </Box>
                        </Box>
                    )}
                    <FocusRing isVisibleWhenFocusWithin={true}>
                        <Box
                            flexGrow="1"
                            overflow="hidden"
                            backgroundColor="grey-0"
                            borderRadius={messageViewBubbleBorderRadius}
                            style={{
                                minHeight: messageViewBubbleMinHeight,
                                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                            }}
                        >
                            <Box
                                ref={useScrollbar()}
                                maxHeight={isMobile ? "48" : "96"}
                                position="relative"
                                overflowX="hidden"
                                overflowY="auto"
                            >
                                <ContentEditor
                                    ref={useMergedRefs(editorRef, externalEditorRef ?? null)}
                                    state={state}
                                    onChange={(state, transaction) => {
                                        onChange(state);
                                        if (transaction.docChanged) showTypingIndicator();
                                    }}
                                    onFocus={handleFocus}
                                    onBlur={handleBlur}
                                    aria-label={`New ${messageNoun}`}
                                    placeholder={placeholder}
                                    className={sprinkles({
                                        paddingX: messageViewBubblePaddingX,
                                        paddingY: messageViewBubblePaddingY,
                                    })}
                                    onEnterFromPhysicalKeyboard={event => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onSend();
                                    }}
                                    onArrowUp={onArrowUp}
                                    // Don't render the default content editor mobile keyboard toolbar. We render
                                    // our own `<MessageInputMobileKeyboardToolbar>` outside of the content editor.
                                    withoutMobileKeyboardToolbar={true}
                                    // Message input is always editable, never interactive on mobile. So you can't
                                    // click links among other things.
                                    withoutMobileDualModality={true}
                                />
                            </Box>
                        </Box>
                    </FocusRing>
                    <Box display="flex" alignItems="flex-end">
                        <Box
                            width={accountAvatarSize}
                            style={{
                                paddingTop: accountAvatarPaddingY,
                                paddingBottom: accountAvatarPaddingY,
                            }}
                        >
                            <IconButton
                                variant="accent"
                                description={`Send ${messageNoun}`}
                                onPress={onSend}
                                isDisabled={isSendButtonDisabled}
                                isPending={isSendButtonPending}
                                // The send icon button is not focusable. That's because we don't want to
                                // remove focus from the message input when the send button is pressed. That
                                // way on mobile you can keep typing and sending messages because the software
                                // keyboard doesn't disappear.
                                //
                                // On desktop, hitting enter in the message input is sufficient for keyboard
                                // control of the message input.
                                isFocusable={false}
                            >
                                {isSendBottomArrowRight ? (
                                    <ArrowRight
                                        size={spacing["4"]}
                                        weight={!isSendButtonDisabled ? "bold" : undefined}
                                    />
                                ) : (
                                    <ArrowUp
                                        size={spacing["4"]}
                                        weight={!isSendButtonDisabled ? "bold" : undefined}
                                    />
                                )}
                            </IconButton>
                        </Box>
                    </Box>
                </Box>
            </Box>
            {isMobile && isBottomBar && (
                <MessageInputMobileKeyboardToolbar
                    state={state}
                    editorRef={editorRef}
                    isVisible={isKeyboardToolbarVisible}
                />
            )}
        </Box>
    );
}
