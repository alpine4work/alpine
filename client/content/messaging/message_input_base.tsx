import {animate} from "motion";
import {ArrowArcLeft, ArrowRight, ArrowUp, PencilSimple, X} from "phosphor-react";
import {
    Key,
    ReactElement,
    Ref,
    RefAttributes,
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {MessageInputMobileKeyboardToolbar} from "~/client/content/messaging/message_input_mobile_keyboard_toolbar.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/design/mobile_bottom_bar.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useRegisterBottomBarFrame} from "~/client/design/subscribe_to_bottom_bar_frame_change.js";
import {useIsTextInputFocused} from "~/client/design/use_is_text_input_focused.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
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
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getTruncatedMessageContentForReplyPreview} from "~/shared/messaging/get_truncated_message_content_for_reply_preview.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    defaultMessageViewMarginX,
    getMessageBubbleMarginLeft,
    messageInputMinHeight,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewReplyPreviewBubbleOpacity,
    messageViewReplyPreviewOpacity,
    messageViewReplyPreviewScale,
} from "~/shared/messaging/messaging_shared_styles.js";
import {
    borderRadius,
    colorSchemeVars,
    contentViewStyles,
    sprinkles,
} from "~/shared/styles/styles.js";

export const messageInputPaddingY: Spacing = "3";
export const messageInputAccountAvatarSize: Spacing = "7";
export const messageInputAccountAvatarPaddingY: RemLength = `${
    (parseRemLengthNumber(messageViewBubbleMinHeight) -
        parseRemLengthNumber(spacing[messageInputAccountAvatarSize])) /
    2
}rem`;

export type MessageInputRef = {
    isFocused(): boolean;
    focus(options?: FocusOptions): void;
    isEmpty(): boolean;
    clear(): void;
    getBoundingClientRect(): DOMRect;
};

export type MessageInputBaseProps<RoomKey extends string, Message extends MessageModel<RoomKey>> = {
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
    messageEditingForThisInput?: {
        state: {isEditing: true; messageIndex: number};
        dispatch: (action: {type: "CancelEditing"}) => void;
    } | null;
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
};

const MessageInputBaseForwardRef = forwardRef(MessageInputBase) as <
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>(
    props: MessageInputBaseProps<RoomKey, Message> & RefAttributes<MessageInputRef>,
) => ReactElement;
export {MessageInputBaseForwardRef as MessageInputBase};

/**
 * Presentational `<MessageInput>` component without any state associated with
 * the actual `<MessageInput>` component.
 *
 * `<MessageInputBase>` lives in `~/client/content` because
 * `<ContentEditorCommentInputFloater>` and
 * `<ContentEditorMobileCommentInputBottomBar>` import it which live in
 * `~/client/content`.
 */
function MessageInputBase<RoomKey extends string, Message extends MessageModel<RoomKey>>(
    {
        messageNoun = "message",
        messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
        state,
        onChange,
        onSend: onSendProp,
        isBottomBar = false,
        withMobileLayout: withMobileLayoutProp,
        isSendBottomArrowRight,
        isSendButtonDisabled: isSendButtonDisabledProp,
        isSendButtonPending,
        messageEditingForThisInput = null,
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
        placeholder = `${
            messageEditingForThisInput ? "Edit" : messageNoun === "message" ? "Send a" : "Add a"
        } ${messageNoun}`,
    }: MessageInputBaseProps<RoomKey, Message>,
    ref: Ref<MessageInputRef>,
) {
    const isMobile = useIsMobile();
    const clientInfo = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const containerRef = useRef<HTMLDivElement>(null);
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const clear = useEvent(() => {
        onChange(ContentEditorState.create(emptyMessageContentWithReferences));
    });

    useImperativeHandle(
        ref,
        () => ({
            isFocused: () => assertExists(editorRef.current).isFocused(),
            focus: options => assertExists(editorRef.current).focus(options),
            isEmpty: () => isContentEmpty(assertExists(editorRef.current).getState().getDoc()),
            clear,
            getBoundingClientRect: () => assertExists(containerRef.current).getBoundingClientRect(),
        }),
        [clear],
    );

    const isEditingMessage = !!messageEditingForThisInput;

    const replyingToMessage = useMemo(() => {
        if (isEditingMessage) return null;
        if (!replyingToMessageProp) return null;

        return {
            message: replyingToMessageProp,
            truncatedContent: getTruncatedMessageContentForReplyPreview({
                message: replyingToMessageProp,
                messageStartOfSentenceNoun,
            }),
        };
    }, [isEditingMessage, replyingToMessageProp, messageStartOfSentenceNoun]);

    // Focus the message input whenever the message we're replying to changes. Or
    // if we start editing the message.
    const focusKey =
        replyingToMessage?.message.index !== undefined
            ? `Replying:${replyingToMessage?.message.index}`
            : isEditingMessage
            ? `Editing:${messageEditingForThisInput.state.messageIndex}`
            : null;
    const lastFocusKeyRef = useRef<Key | null>(null);
    useEffect(() => {
        if (lastFocusKeyRef.current === focusKey) return;
        lastFocusKeyRef.current = focusKey;

        if (focusKey === null) return;

        // Make sure we've finished painting the change causing us to focus before
        // actually focusing the editor.
        //
        // NOTE(calebmer): Added this so that when you swipe to reply in our native
        // mobile apps, the non-animated bottom bar frame change consistently happens
        // before the animated keyboard frame change. Before adding double
        // `requestAnimationFrame()` sometimes the keyboard animation would start
        // before the bottom bar resize observer fired.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const editor = assertExists(editorRef.current);
                editor.focus();
            });
        });
    }, [focusKey]);

    const isSendButtonDisabled =
        isSendButtonDisabledProp || (!isEditingMessage && isContentEmpty(state.getDoc()));

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

    // 1. On mobile, make sure our keyboard toolbar is visible when any text input
    //    is focused
    // 2. On mobile web, animate so our toolbar is visible. In our native app, the
    //    shell manages animating the toolbar so it's visible (done in an effect)
    //
    // We check for whether any text input is focused (not just the message input)
    // since on native mobile, the message input will slide up regardless when the
    // keyboard opens whether the keyboard opened from the message input or
    // something else (e.g. `<ChatAccountPicker>` element).
    const {isTextInputFocused: isKeyboardToolbarVisible} = useIsTextInputFocused({
        isDisabled: !isMobile || !isBottomBar,
    });

    const lastIsKeyboardToolbarVisibleRef = useRef(isKeyboardToolbarVisible);
    useEffect(() => {
        if (NativeMobileBridge) return;

        if (lastIsKeyboardToolbarVisibleRef.current === isKeyboardToolbarVisible) return;
        lastIsKeyboardToolbarVisibleRef.current = isKeyboardToolbarVisible;

        const containerElement = assertExists(containerRef.current);

        if (isKeyboardToolbarVisible) {
            animate(
                containerElement,
                {
                    y: [0, -mobileBottomBarKeyboardToolbarHeightRem * getRemPxWithoutListening()],
                },
                {
                    duration: 0.2,
                    // Make sure we use hardware acceleration for this animation in WebKit. By
                    // default `motion` turns it off.
                    // https://motion.dev/guides/performance#webkits-exceptions
                    allowWebkitAcceleration: true,
                },
            );
        } else {
            animate(
                containerElement,
                {
                    y: [-mobileBottomBarKeyboardToolbarHeightRem * getRemPxWithoutListening(), 0],
                },
                {
                    duration: 0.2,
                    // Make sure we use hardware acceleration for this animation in WebKit. By
                    // default `motion` turns it off.
                    // https://motion.dev/guides/performance#webkits-exceptions
                    allowWebkitAcceleration: true,
                },
            );
        }
    }, [isKeyboardToolbarVisible]);

    const handleFocus = () => {
        onFocus?.();
    };

    const handleBlur = () => {
        hideTypingIndicator();

        onBlur?.();
    };

    useRegisterBottomBarFrame(inputContainerRef, {
        isDisabled: !isBottomBar,
        withMobileKeyboardToolbar: true,
    });

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
            width="full"
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
                marginX="center"
                paddingY={messageInputPaddingY}
            >
                {isEditingMessage && (
                    <Box
                        position="relative"
                        paddingBottom="3"
                        color="grey-80"
                        style={{
                            paddingLeft: withMobileLayout
                                ? spacing["3"]
                                : getMessageBubbleMarginLeft(marginX),
                            paddingRight: addRemLengths(spacing["2"], spacing["7"], spacing["5"]),
                        }}
                    >
                        <Box
                            paddingLeft="0.5"
                            display="flex"
                            alignItems="center"
                            gap="1"
                            fontSize="50"
                            fontStyle="truncate"
                        >
                            <PencilSimple size={spacing["3"]} />
                            <span>Editing message</span>
                            <Box paddingLeft="1" style={{transform: "translateY(1px)"}}>
                                <IconButton
                                    size="xs"
                                    description="Cancel editing"
                                    onPress={() => {
                                        messageEditingForThisInput.dispatch({
                                            type: "CancelEditing",
                                        });
                                    }}
                                    // Not focusable so clicking on this button doesn't unfocus
                                    // the input.
                                    isFocusable={false}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </Box>
                    </Box>
                )}
                {replyingToMessage &&
                    (() => {
                        const height = addRemLengths(
                            spacing["1.5"],
                            contentViewStyles.truncatedHeight,
                            spacing["1.5"],
                        );

                        const scaledHeight = `${
                            Math.round(
                                parseRemLengthNumber(height) * messageViewReplyPreviewScale * 16,
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
                                    gap="1"
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
                                    <Box paddingLeft="1" style={{transform: "translateY(1px)"}}>
                                        <IconButton
                                            size="xs"
                                            description="Cancel reply"
                                            onPress={onClearReplyingToMessage}
                                            // Not focusable so clicking on this button doesn't unfocus
                                            // the input.
                                            isFocusable={false}
                                        >
                                            <X />
                                        </IconButton>
                                    </Box>
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
                                                transform: `scale(${messageViewReplyPreviewScale})`,
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
                                width={messageInputAccountAvatarSize}
                                style={{
                                    paddingTop: messageInputAccountAvatarPaddingY,
                                    paddingBottom: messageInputAccountAvatarPaddingY,
                                }}
                            >
                                <AccountAvatar
                                    account={currentAccount}
                                    size={messageInputAccountAvatarSize}
                                />
                            </Box>
                        </Box>
                    )}
                    <FocusRing offset="border" isVisibleWhenFocusWithin={true}>
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
                                ref={useScrollbar({
                                    insetTop: borderRadius[messageViewBubbleBorderRadius],
                                    insetBottom: borderRadius[messageViewBubbleBorderRadius],
                                })}
                                maxHeight={isMobile ? "48" : "96"}
                                position="relative"
                                overflowX="hidden"
                                overflowY="auto"
                            >
                                <ContentEditor
                                    ref={editorRef}
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
                            width={messageInputAccountAvatarSize}
                            style={{
                                paddingTop: messageInputAccountAvatarPaddingY,
                                paddingBottom: messageInputAccountAvatarPaddingY,
                            }}
                        >
                            <IconButton
                                variant="accent"
                                description={
                                    isEditingMessage ? `Save ${messageNoun}` : `Send ${messageNoun}`
                                }
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
