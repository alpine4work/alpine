import {animate} from "motion";
import {ArrowArcLeft, ArrowRight, ArrowUp, PencilSimple, X} from "phosphor-react";
import {EditorView} from "prosemirror-view";
import {
    FocusEvent,
    Key,
    ReactElement,
    Ref,
    RefAttributes,
    RefObject,
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {
    ContentEditorMobileLinkModal,
    ContentEditorMobileLinkModalState,
} from "~/client/content/internal/content_editor_mobile_link_modal.js";
import {MessageInputMobileKeyboardToolbar} from "~/client/content/messaging/message_input_mobile_keyboard_toolbar.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/design/mobile_bottom_bar.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {
    useRegisterBottomBarFrame,
    useWebMobileKeyboardToolbarSafeAreaInsetBottom,
} from "~/client/design/subscribe_to_bottom_bar_frame_change.js";
import {useIsBehindMobileFullScreenModal} from "~/client/design/use_is_behind_mobile_full_screen_modal.js";
import {useIsTextInputFocused} from "~/client/design/use_is_text_input_focused.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {getRemPxWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    getMessageBubbleMarginLeft,
    messageInputAccountAvatarPaddingY,
    messageInputAccountAvatarSize,
    messageInputMinHeight,
    messageInputPaddingY,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMaxWidth,
    messageViewReplyPreviewBubbleOpacity,
    messageViewReplyPreviewOpacity,
    messageViewParentScale,
} from "~/client/styles/messaging_shared_styles.js";
import {borderRadius, contentViewStyles, sprinkles} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    Spacing,
    addRemLengths,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getTruncatedMessageContentForReplyPreview} from "~/client/messaging/get_truncated_message_content_for_reply_preview.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";

export type MessageInputRef = {
    isFocused(): boolean;
    focus(options?: FocusOptions): void;
    blur(): void;
    isEmpty(): boolean;
    clear(): void;
    getBoundingClientRect(): DOMRect;
};

export type MessageInputBaseProps<RoomKey extends string, Message extends MessageModel<RoomKey>> = {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    sendButtonVerb?: string;
    placeholder?: string;
    state: ContentEditorState<MessageContentWithReferences>;
    onChange: (state: ContentEditorState<MessageContentWithReferences>) => void;
    onSend: () => void;
    isBottomBar?: boolean;
    isReplacingOtherBottomBar?: boolean;
    isSendBottomArrowRight?: boolean;
    isSendButtonDisabled?: boolean;
    isSendButtonPending?: boolean;
    isNativeMobileRefocusHackDisabled?: boolean;
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
    paddingX?: Spacing | {desktop: Spacing; mobile: Spacing};
    withMobileMaxHeight?: boolean;
    onFocus?: (event: FocusEvent) => void;
    onFocusCapture?: (event: FocusEvent) => void;
    onBlur?: (event: FocusEvent) => void;
    onBeforeFocusFromReplyOrEditingChange?: () => {preventDefault: boolean} | void;
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
        isReplacingOtherBottomBar = false,
        isSendBottomArrowRight,
        isSendButtonDisabled: isSendButtonDisabledProp,
        isSendButtonPending,
        isNativeMobileRefocusHackDisabled,
        messageEditingForThisInput = null,
        replyingToMessage: replyingToMessageProp,
        onClearReplyingToMessage,
        onJumpToMessage,
        onShowTypingIndicator,
        onHideTypingIndicator,
        "data-testid": dataTestId,
        paddingX = screenPaddingX,
        withMobileMaxHeight,
        onFocus,
        onFocusCapture,
        onBlur,
        onBeforeFocusFromReplyOrEditingChange: onBeforeFocusFromReplyOrEditingChangeProp,
        onArrowUp,
        sendButtonVerb = messageEditingForThisInput ? "Save" : "Send",
        placeholder = `${
            messageEditingForThisInput ? "Edit" : messageNoun === "message" ? "Send a" : "Add a"
        } ${messageNoun}`,
    }: MessageInputBaseProps<RoomKey, Message>,
    ref: Ref<MessageInputRef>,
) {
    const platform = usePlatform();
    const clientInfo = useClientInfo();
    const {currentAccount} = useSpaceContext();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    const inputContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLDivElement>(null);
    const inputContentRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const viewRef: RefObject<EditorView> = useMemo(
        () => ({
            get current() {
                return editorRef.current?._getInternalView() ?? null;
            },
        }),
        [editorRef],
    );

    const clear = useEvent(() => {
        onClearReplyingToMessage?.();
        messageEditingForThisInput?.dispatch({type: "CancelEditing"});
        onChange(ContentEditorState.create(emptyMessageContentWithReferences));
    });

    useImperativeHandle(
        ref,
        () => ({
            isFocused: () => assertExists(editorRef.current).isFocused(),
            focus: options => assertExists(editorRef.current).focus(options),
            blur: () => assertExists(editorRef.current).blur(),
            isEmpty: () => isContentEmpty(assertExists(editorRef.current).getState().getDoc()),
            clear,
            getBoundingClientRect: () => assertExists(inputRef.current).getBoundingClientRect(),
        }),
        [clear],
    );

    const isEditingMessage = !!messageEditingForThisInput;

    const replyingToMessage = useMemo(() => {
        if (isEditingMessage) return null;
        if (!replyingToMessageProp) return null;

        // NOCOMMIT
        getTruncatedMessageContentForReplyPreview({
            message: replyingToMessageProp,
            messageNoun,
        });

        return {
            message: replyingToMessageProp,
            truncatedContent: emptyMessageContentWithReferences,
        };
    }, [isEditingMessage, replyingToMessageProp, messageStartOfSentenceNoun]);

    const onBeforeFocusFromReplyOrEditingChange = useEvent(
        onBeforeFocusFromReplyOrEditingChangeProp,
    );

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

        const result = onBeforeFocusFromReplyOrEditingChange?.();
        if (result?.preventDefault) return;

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
    }, [focusKey, onBeforeFocusFromReplyOrEditingChange]);

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
        isDisabled: platform !== "mobile" || !isBottomBar,
    });

    const [isKeyboardToolbarCompletelyHiddenFromState, setIsKeyboardToolbarCompletelyHidden] =
        useState(true);
    const isKeyboardToolbarCompletelyHidden =
        isKeyboardToolbarCompletelyHiddenFromState && !isKeyboardToolbarVisible;
    if (isKeyboardToolbarCompletelyHidden !== isKeyboardToolbarCompletelyHiddenFromState)
        setIsKeyboardToolbarCompletelyHidden(isKeyboardToolbarCompletelyHidden);

    const lastIsKeyboardToolbarVisibleRef = useRef(isKeyboardToolbarVisible);
    useEffect(() => {
        if (lastIsKeyboardToolbarVisibleRef.current === isKeyboardToolbarVisible) return;
        lastIsKeyboardToolbarVisibleRef.current = isKeyboardToolbarVisible;

        const inputElement = assertExists(inputRef.current);

        if (isKeyboardToolbarVisible) {
            if (NativeMobileBridge) {
                // Noop...
            } else {
                animate(
                    inputElement,
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
            }
        } else {
            if (NativeMobileBridge) {
                NativeMobileBridge.keyboard.scheduleAfterAnimation(() => {
                    setIsKeyboardToolbarCompletelyHidden(true);
                });
            } else {
                const animation = animate(
                    inputElement,
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

                void animation.finished.finally(() => {
                    setIsKeyboardToolbarCompletelyHidden(true);
                });
            }
        }
    }, [isKeyboardToolbarVisible]);

    const [isFocused, setIsFocused] = useState(false);

    const lastNativeMobileWebKitRefocusTimeRef = useRef<number | null>(null);

    const handleFocus = (event: FocusEvent) => {
        setIsFocused(true);
        onFocus?.(event);

        // HACK(calebmer, #mobile-webkit-weirdness): Absolute hack. We animate up
        // message inputs in our native mobile wrapper so the animation is synced
        // with the keyboard. However, sometimes WebKit doesn't know the selection
        // has translated up as well. Calling blur/focus after the keyboard animation
        // (which is ~2.5s) forces WebKit to re-render the selection in the right
        // location.
        //
        // Ideally native code would find a way to animate the selection with the
        // keyboard as well but I can't find a way to do that right now. My guess would
        // be you gotta call `selectionWillChange()` and `selectionDidChange()` on
        // [`UITextInputDelegate`][1] but I tried that and it didn't work.
        //
        // Or we find a different way to force the text cursor to re-render.
        //
        // [1]: https://developer.apple.com/documentation/uikit/uitextinputdelegate
        if (
            !isNativeMobileRefocusHackDisabled &&
            NativeMobileBridge &&
            isBottomBar &&
            isMobileWebKit &&
            // Make sure we don't get stuck in a refocus loop.
            (lastNativeMobileWebKitRefocusTimeRef.current === null ||
                Date.now() - lastNativeMobileWebKitRefocusTimeRef.current > 1000)
        ) {
            setTimeout(() => {
                if (editorRef.current?.isFocused()) {
                    lastNativeMobileWebKitRefocusTimeRef.current = Date.now();

                    editorRef.current.blur();
                    editorRef.current.focus();
                }
            }, 300);
        }
    };

    const handleBlur = (event: FocusEvent) => {
        setIsFocused(false);
        hideTypingIndicator();
        onBlur?.(event);
    };

    useRegisterBottomBarFrame(inputContentRef, {
        // Register as a bottom bar when focused even in a `position: sticky` context.
        // That's because we want typing in the input to scroll the messages above the
        // input when the input is sticking to the bottom of the view.
        isDisabled: !isBottomBar && !isFocused,
        withMobileKeyboardToolbar: true,
        isReplacingOtherBottomBar,
    });

    useWebMobileKeyboardToolbarSafeAreaInsetBottom({isVisible: !isKeyboardToolbarCompletelyHidden});

    const [linkModalState, setLinkModalState] = useState<ContentEditorMobileLinkModalState | null>(
        null,
    );

    const lastLinkModalStateRef = useRef(linkModalState);
    useEffect(() => {
        if (lastLinkModalStateRef.current === linkModalState) return;
        lastLinkModalStateRef.current = linkModalState;

        if (!linkModalState) {
            // Refocus the content editor after the modal is done closing.
            if (!NativeMobileBridge) {
                assertExists(editorRef.current).focus();
            } else {
                // Focus after the navigation animation finishes. The keyboard can't open while
                // the navigation animation is running.
                NativeMobileBridge.navigation.scheduleAfterAnimation(() => {
                    assertExists(editorRef.current).focus();
                });
            }
        }
    }, [linkModalState]);

    const idBase = useId();
    const containerId = `${idBase}-container`;
    const id = isBottomBar && clientInfo.isNativeMobile && !isInert ? `nmbb-wkt-${idBase}` : idBase;

    // Extra slop that extends beneath the bottom of the message input. This is
    // always cut off on desktop. However, it matters in our native mobile app.
    // When we animate the message input with the keyboard, their translations
    // aren't perfectly in sync (even though the timing is in sync). So there are
    // moments in the animation where the content may be revealed between the
    // message input and the keyboard. To fix this, we just make them message input
    // bigger so it can cover content below while animating. To debug this turn on
    // slow animations in an iOS emulator and open the keyboard.
    const bottomBarBackgroundSlopBottom = spacing["96"];

    const avatarPaddingY = messageInputAccountAvatarPaddingY[platform];

    return (
        <Box
            ref={inputContainerRef}
            id={containerId}
            // Focusable, but not by keyboard. Only by JavaScript.
            tabIndex={-1}
            flexShrink="0"
        >
            <Box
                ref={inputRef}
                // Completely remount the component if the `id` changes. The `id` only really
                // changes if the message input stops being a native mobile bottom bar (aka
                // `isInert` changes). That way our native wrapper app correctly detects the
                // bottom bar change.
                key={id}
                data-testid={dataTestId}
                id={id}
                width="full"
                backgroundColor="grey-0"
                style={{
                    minHeight: !isBottomBar
                        ? messageInputMinHeight[platform]
                        : `calc(${
                              platform === "mobile"
                                  ? addRemLengths(
                                        messageInputMinHeight.mobile,
                                        mobileBottomBarKeyboardToolbarHeight,
                                    )
                                  : messageInputMinHeight.desktop
                          } + var(--window-safe-area-inset-bottom, 0px))`,
                    paddingBottom: isBottomBar
                        ? clientInfo.isNativeMobile
                            ? `calc(${bottomBarBackgroundSlopBottom} + var(--window-safe-area-inset-bottom, 0px))`
                            : "var(--window-safe-area-inset-bottom, 0px)"
                        : undefined,
                    marginBottom:
                        isBottomBar && clientInfo.isNativeMobile
                            ? `-${addRemLengths(
                                  bottomBarBackgroundSlopBottom,
                                  mobileBottomBarKeyboardToolbarHeight,
                              )}`
                            : isBottomBar && platform === "mobile"
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
                    willChange:
                        isBottomBar && clientInfo.isNativeMobile && !isInert
                            ? "transform"
                            : undefined,
                    // Set `transform` to its initial value assuming the tab bar is up.
                    transform:
                        isBottomBar && clientInfo.isNativeMobile
                            ? "translateY(calc(var(--window-safe-area-inset-bottom, 0px) - var(--safe-area-inset-bottom, 0px)))"
                            : undefined,
                }}
                // Suppress React hydration warnings in our native mobile app. The native
                // mobile app sets the `transform` property on this element. Sometimes before
                // React finishes hydrating. This is expected, React can ignore the difference.
                suppressHydrationWarning={
                    isBottomBar && clientInfo.isNativeMobile && !isInert ? true : undefined
                }
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
                <OverlayScopeContextProvider
                // Render an overlay scope here so that overlays are animated with the
                // keyboard opening.
                >
                    <Box
                        ref={inputContentRef}
                        width="full"
                        maxWidth={messageViewMaxWidth}
                        marginX="center"
                    >
                        {isEditingMessage && (
                            <Box
                                position="relative"
                                paddingTop={messageInputPaddingY}
                                color="grey-80"
                                style={{
                                    paddingLeft:
                                        platform === "mobile"
                                            ? spacing["3"]
                                            : getMessageBubbleMarginLeft(
                                                  typeof paddingX === "string"
                                                      ? paddingX
                                                      : paddingX.desktop,
                                              ),
                                    paddingRight: addRemLengths("2", "7", "5"),
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
                                    <Box paddingLeft="0.5" style={{transform: "translateY(1px)"}}>
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
                                    "1.5",
                                    contentViewStyles.truncatedHeight,
                                    "1.5",
                                );

                                const scaledHeight = `${
                                    Math.round(
                                        parseRemLength(height) * messageViewParentScale * 16,
                                    ) / 16
                                }rem`;

                                return (
                                    <Box
                                        position="relative"
                                        paddingTop={messageInputPaddingY}
                                        paddingBottom="1"
                                        style={{
                                            paddingLeft:
                                                platform === "mobile"
                                                    ? spacing["3"]
                                                    : getMessageBubbleMarginLeft(
                                                          typeof paddingX === "string"
                                                              ? paddingX
                                                              : paddingX.desktop,
                                                      ),
                                            paddingRight: addRemLengths("2", "7", "5"),
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
                                            <Box
                                                paddingLeft="0.5"
                                                style={{transform: "translateY(1px)"}}
                                            >
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
                                                        transform: `scale(${messageViewParentScale})`,
                                                        transformOrigin: "0% 0% 0",
                                                    }}
                                                    onClick={() =>
                                                        onJumpToMessage?.(replyingToMessage.message)
                                                    }
                                                    onKeyDown={event => {
                                                        if (
                                                            event.key === "Enter" ||
                                                            event.key === " "
                                                        ) {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            onJumpToMessage?.(
                                                                replyingToMessage.message,
                                                            );
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
                                                            opacity:
                                                                messageViewReplyPreviewBubbleOpacity,
                                                        }}
                                                    />
                                                    <Box overflow="hidden" pointerEvents="none">
                                                        <ContentView
                                                            isInert={true}
                                                            isTruncated={true}
                                                            isBackgroundColorGrey5={true}
                                                            content={
                                                                replyingToMessage.truncatedContent
                                                            }
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
                            paddingX={paddingX}
                            paddingY={messageInputPaddingY}
                            gap="2"
                        >
                            {platform !== "mobile" && (
                                <Box display="flex" alignItems="flex-end">
                                    <Box
                                        width={messageInputAccountAvatarSize}
                                        style={{
                                            paddingTop: avatarPaddingY,
                                            paddingBottom: avatarPaddingY,
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
                                    position="relative"
                                    borderRadius={messageViewBubbleBorderRadius}
                                >
                                    <Box
                                        pointerEvents="none"
                                        position="absolute"
                                        zIndex="10"
                                        inset="0"
                                        border="grey-10"
                                        borderRadius={messageViewBubbleBorderRadius}
                                        style={{
                                            // NOTE(calebmer, #mobile-webkit-weirdness): In order for mobile WebKit to
                                            // render the border on top of `codeBlock` node sticky elements and to render
                                            // the native scrollbar on top of `codeBlock` node sticky elements we need to:
                                            //
                                            // 1. Render border in a `z-index: 10` element with
                                            //    `-webkit-transform: translateZ(0)`. Using
                                            //    `box-shadow: inset 0 0 0 1px grey-10` on a parent doesn't work.
                                            // 2. Set `z-index: 0` on the scroll container (this is important!).
                                            //
                                            // WebKit only working in these specific conditions definitely seems to be a
                                            // bug. Other browsers work without `-webkit-transform: translateZ(0)` for
                                            // instance.
                                            transform: "translateZ(0)",
                                            WebkitTransform: "translateZ(0)",
                                        }}
                                    />
                                    <Box
                                        ref={useScrollbar({
                                            insetY: borderRadius[
                                                messageViewBubbleBorderRadius[platform]
                                            ],
                                        })}
                                        maxHeight={
                                            platform === "mobile" || withMobileMaxHeight
                                                ? "48"
                                                : "96"
                                        }
                                        position="relative"
                                        zIndex="0"
                                        overflowX="hidden"
                                        overflowY="auto"
                                        borderRadius={messageViewBubbleBorderRadius}
                                        style={{
                                            minHeight: messageViewBubbleMinHeight[platform],
                                        }}
                                    >
                                        <ContentEditor
                                            ref={editorRef}
                                            state={state}
                                            onChange={(state, transaction) => {
                                                onChange(state);
                                                if (transaction.docChanged) showTypingIndicator();
                                            }}
                                            onFocus={handleFocus}
                                            onFocusCapture={onFocusCapture}
                                            onBlur={handleBlur}
                                            aria-label={
                                                isEditingMessage
                                                    ? messageStartOfSentenceNoun
                                                    : `New ${messageNoun}`
                                            }
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
                                        paddingTop: avatarPaddingY,
                                        paddingBottom: avatarPaddingY,
                                    }}
                                >
                                    <IconButton
                                        variant="accent"
                                        description={`${sendButtonVerb} ${messageNoun}`}
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
                                                style={{
                                                    // Optically, this icon looks...off in our iOS native mobile app.
                                                    // Presumably everywhere in Safari. If only we had a
                                                    // `clientInfo.isWebKit` test.
                                                    transform:
                                                        clientInfo.isNativeMobile &&
                                                        clientInfo.isAppleDevice
                                                            ? "translateY(0.5px)"
                                                            : undefined,
                                                }}
                                            />
                                        )}
                                    </IconButton>
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                    {platform === "mobile" && isBottomBar && (
                        <MessageInputMobileKeyboardToolbar
                            state={state._getInternalState()}
                            viewRef={viewRef}
                            isVisible={isKeyboardToolbarVisible}
                            onLinkModalOpen={setLinkModalState}
                            inputContainerRef={inputContainerRef}
                        />
                    )}
                </OverlayScopeContextProvider>
            </Box>
            {linkModalState && (
                // Important: This must live outside the message input element which changes
                // its `key` when it becomes inert which would cause this component to unmount.
                <MobileFullScreenModal
                    // Important: Tells `useConfirmSaveAfterLosingFocus()` (used by document comment
                    // input) that when focus is within the link modal we're still actually editing
                    // the comment input.
                    data-ownedby={containerId}
                    onClose={() => setLinkModalState(null)}
                >
                    {({onCloseWithAnimation}) => (
                        <ContentEditorMobileLinkModal
                            viewRef={viewRef}
                            initialText={linkModalState.initialText}
                            isTextEditable={linkModalState.isTextEditable}
                            initialUrl={linkModalState.initialUrl}
                            onCloseWithAnimation={() => {
                                const inputContainerElement = assertExists(
                                    inputContainerRef.current,
                                );

                                // In our native mobile app, blur the link modal input before animating the
                                // modal closed. In our web mobile app, we want to keep focus in a hidden input
                                // so the keyboard doesn't close.
                                //
                                // - In native mobile, even if we maintain focus in the DOM, iOS will do the
                                //   keyboard open/close animation. We might as well control the timing there.
                                //
                                // - In web mobile, the keyboard open/close animation is incredibly janky since
                                //   we don't have the same level of control as we do in native. So it feels
                                //   better to keep the keyboard open the whole time.
                                if (NativeMobileBridge) {
                                    // Instead of blurring the link modal input, focus the toolbar element (which
                                    // has the same effect). That way `useConfirmSaveAfterLosingFocus()` (which we
                                    // use for document comment editing) sees that focus stays within the message
                                    // input.
                                    inputContainerElement.focus();

                                    NativeMobileBridge.keyboard.scheduleAfterAnimation(() => {
                                        onCloseWithAnimation({withoutFocus: true});
                                    });
                                } else {
                                    // If there's currently an element with focus in the link modal, move focus to
                                    // a temporary, invisible, element to keep the keyboard open. Once we've
                                    // finished closing the modal then focus will return to the content editor.
                                    if (document.activeElement) {
                                        const temporaryInputElement =
                                            document.createElement("input");
                                        temporaryInputElement.type = "text";
                                        temporaryInputElement.style.width = "0";
                                        temporaryInputElement.style.height = "0";
                                        temporaryInputElement.style.margin = "0";
                                        temporaryInputElement.style.padding = "0";
                                        temporaryInputElement.style.border = "0";
                                        temporaryInputElement.style.opacity = "0";
                                        temporaryInputElement.style.position = "fixed";
                                        temporaryInputElement.style.top = "0px";

                                        // This is a hack. We want `react-aria`'s `<FocusScope contain>` to let us move
                                        // focus to this temporary input element. If `react-aria` sees this attribute
                                        // it allows moving focus to the element. This is designed for elements like
                                        // toasts but we abuse it here.
                                        //
                                        // https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/focus/src/FocusScope.tsx#L405-L408
                                        temporaryInputElement.setAttribute(
                                            "data-react-aria-top-layer",
                                            "",
                                        );

                                        inputContainerElement.appendChild(temporaryInputElement);
                                        temporaryInputElement.addEventListener("blur", () => {
                                            temporaryInputElement.parentElement?.removeChild(
                                                temporaryInputElement,
                                            );
                                        });
                                        temporaryInputElement.focus();

                                        // NOTE(calebmer): I'm not sure why we need this to get focus to stick on
                                        // `temporaryInputElement`, but we do. Probably something to do with
                                        // `<FocusScope>`? If we don't have this then a focus event is never dispatched
                                        // to `temporaryInputElement`.
                                        scheduleMacrotask(() => {
                                            if (
                                                inputContainerElement.contains(
                                                    temporaryInputElement,
                                                )
                                            ) {
                                                temporaryInputElement.focus();
                                            }
                                        });
                                    }

                                    onCloseWithAnimation({withoutFocus: true});
                                }
                            }}
                        />
                    )}
                </MobileFullScreenModal>
            )}
        </Box>
    );
}
