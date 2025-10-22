import {animate} from "motion";
import {ArrowRight, ArrowUp, File, Image, PencilSimple, Plus, X} from "phosphor-react";
import {Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    FocusEvent,
    Key,
    Memo,
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
import {usePress} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentBlockWidthContextProvider} from "~/client/content/content_block_width.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {useFileRegistry} from "~/client/content/file_registry_context.js";
import {
    ContentEditorMobileLinkModal,
    ContentEditorMobileLinkModalState,
} from "~/client/content/internal/content_editor_mobile_link_modal.js";
import {
    FileInfoWithEntity,
    iterateFileInfosInElement,
} from "~/client/content/internal/iterate_file_infos_in_element.js";
import {
    MessageInputFile,
    addMessageInputFiles,
} from "~/client/content/messaging/add_message_input_files.js";
import {
    getTruncatedMessageContentForReplyPreview,
    getTruncatedMessagesRangeContentForReplyPreview,
    getTruncatedPostContentForReplyPreview,
} from "~/client/content/messaging/get_truncated_message_content_for_reply_preview.js";
import {MessageInputMobileKeyboardToolbar} from "~/client/content/messaging/internal/message_input_mobile_keyboard_toolbar.js";
import {MessageInputFileEntityPreview} from "~/client/content/messaging/message_input_file_entity_preview.js";
import {MessageInputFilePreview} from "~/client/content/messaging/message_input_file_preview.js";
import {selectFiles} from "~/client/content/select_files.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/design/mobile_bottom_bar.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {useReporter} from "~/client/design/reporter.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {
    useRegisterBottomBarFrame,
    useWebMobileKeyboardToolbarSafeAreaInsetBottom,
} from "~/client/design/subscribe_to_bottom_bar_frame_change.js";
import {useIsBehindMobileFullScreenModal} from "~/client/design/use_is_behind_mobile_full_screen_modal.js";
import {useIsTextInputFocused} from "~/client/design/use_is_text_input_focused.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {parseHtml} from "~/client/helpers/parse_html.js";
import {useStore} from "~/client/helpers/use_store.js";
import {VideoIcon} from "~/client/icons/video_icon.js";
import {WaveformIcon} from "~/client/icons/waveform_icon.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {getRemPxWithoutListening, useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {useSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageInputBottomBarBackgroundSlopBottom,
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonNegativeMarginX,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputFilesOverflowGradientWidth,
    messageInputMinHeightPx,
    messageInputPaddingY,
    messageViewAccountAvatarSize,
    messageViewMarginLeft,
    messageViewParentAccountAvatarSize,
    messageViewParentAvatarOffsetYRem,
    messageViewParentFontSize,
    messageViewParentLineHeightPx,
    messageViewRailGap,
} from "~/client/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {trimContentEnd} from "~/shared/content/trim_content.js";
import {fileClassName} from "~/shared/design/core/constant_class_names.js";
import {
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    getFileAudioContentTypes,
    getFileImageContentTypes,
    getFileVideoContentTypes,
} from "~/shared/files/file_content_type.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Id} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export type MessageInputRef = {
    isFocused(): boolean;
    focus(options?: FocusOptions): void;
    blur(): void;
    isEmpty(): boolean;
    clear(): void;
    getBoundingClientRect(): DOMRect;
    drop(dataTransfer: DataTransfer): {finally(listener: () => void): void};
};

export type MessageInputBaseProps<RoomKey extends string, Message extends MessageModel<RoomKey>> = {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    sendButtonVerb?: string;
    placeholder?: string;
    state: ContentEditorState<MessageContentWithReferences>;
    files: ReadonlyArray<MessageInputFile>;
    onChange: (
        state: ContentEditorState<MessageContentWithReferences>,
        transaction: Transaction,
    ) => void;
    onAddFile: ((file: MessageInputFile) => void) | null;
    onRemoveFile: ((fileKey: Id) => void) | null;
    onSend: () => void;
    fileAttachmentTarget: Memo<FileAttachmentTarget> | null;
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
    parent?: MessageContentPayloadParentWithMessages<RoomKey, Message> | null;
    onParentClear?: () => void;
    onJumpToMessageRange?: (options: {
        roomKey: RoomKey;
        startIndex: number;
        endIndex: number;
        start: {version: number; pos: number} | null;
        end: {version: number; pos: number} | null;
    }) => void;
    onJumpToPostRange?: (options: {
        postId: PostId;
        version: number;
        startPos: number;
        endPos: number;
    }) => void;
    onShowTypingIndicator?: () => void;
    onHideTypingIndicator?: () => void;
    "data-testid"?: string;
    withMobileMaxHeight?: boolean;
    onFocus?: (event: FocusEvent) => void;
    onFocusCapture?: (event: FocusEvent) => void;
    onBlur?: (event: FocusEvent) => void;
    onBeforeFocusFromReplyOrEditingChange?: () => {preventDefault: boolean} | void;
    onArrowUpKeyDown?: (event: KeyboardEvent) => void;
};

export type MessageContentPayloadParentWithMessages<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> =
    | {
          readonly type: "Message";
          readonly message: Message;
      }
    | {
          readonly type: "MessagesRange";
          readonly messages: NonEmptyReadonlyArray<Message>;
          readonly startIndex: number;
          readonly endIndex: number;
          readonly startVersion: number;
          readonly endVersion: number;
          readonly startPos: number;
          readonly endPos: number;
      }
    | {
          readonly type: "PostRange";
          readonly post: PostModel;
          readonly version: number;
          readonly startPos: number;
          readonly endPos: number;
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
        files,
        onChange,
        onAddFile,
        onRemoveFile,
        onSend: onSendProp,
        isBottomBar = false,
        isReplacingOtherBottomBar = false,
        isSendBottomArrowRight,
        isSendButtonDisabled: isSendButtonDisabledProp,
        isSendButtonPending,
        isNativeMobileRefocusHackDisabled,
        fileAttachmentTarget,
        messageEditingForThisInput = null,
        parent: parentProp,
        onParentClear,
        onJumpToMessageRange,
        onJumpToPostRange,
        onShowTypingIndicator,
        onHideTypingIndicator,
        "data-testid": dataTestId,
        withMobileMaxHeight,
        onFocus,
        onFocusCapture,
        onBlur,
        onBeforeFocusFromReplyOrEditingChange: onBeforeFocusFromReplyOrEditingChangeProp,
        onArrowUpKeyDown,
        sendButtonVerb = messageEditingForThisInput ? "Save" : "Send",
        placeholder = `${
            messageEditingForThisInput ? "Edit" : messageNoun === "message" ? "Send a" : "Add a"
        } ${messageNoun}`,
    }: MessageInputBaseProps<RoomKey, Message>,
    ref: Ref<MessageInputRef>,
) {
    const context = useAppContext();
    const reporter = useReporter();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();
    const {space} = useSpaceContext();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;
    const isMounted = useIsMounted();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

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

    const events = useEvents({
        clear: () => {
            onParentClear?.();
            messageEditingForThisInput?.dispatch({type: "CancelEditing"});

            const [newState, transaction] = state.delete();
            onChange(newState, transaction);
        },
        addFiles: (
            spanName: string,
            fileInfos: ReadonlyArray<FileInfoWithEntity>,
        ): {finally(listener: () => void): void} => {
            // Noop if we don't have an add file callback.
            if (!onAddFile) return Promise.resolve();

            if (fileInfos.length === 0) return Promise.resolve();

            // Make sure the input is focused when we add files. So the user can hit
            // "Enter" after dropping a file to send the message. This also has the effect
            // of making sure `useRegisterBottomBarFrame()` isn't disabled so when the
            // message input size changes we scroll.
            assertExists(editorRef.current).focus({preventScroll: true});

            const promise = context.tracer.withSpan(spanName, async context => {
                await addMessageInputFiles(context, fileInfos, {
                    spaceId: space.id,
                    attachmentTarget: fileAttachmentTarget,
                    addGlobalLoadingIndicator,
                    onAddFile: file => {
                        // Noop if our input was unmounted (e.g. after the message is sent we remount
                        // this component).
                        if (!isMounted()) return;

                        onAddFile(file);
                    },
                });
            });

            promise.catch(error => {
                reporter.displayError("Couldn’t upload file", error);
            });

            return promise;
        },
        drop: (dataTransfer: DataTransfer): {finally(listener: () => void): void} => {
            let hasHtmlFileInfos = false;
            const fileInfos: Array<FileInfoWithEntity> = [];

            for (const {info} of iterateFileInfosInElement(
                parseHtml(dataTransfer.getData("text/html")),
                () => space.id,
            )) {
                if (!info) continue;

                hasHtmlFileInfos = true;
                fileInfos.push(info);
            }

            // Ignore files from `dataTransfer` if we had `text/html`. Since we assume
            // `text/html` will contain links to any files included in `dataTransfer`.
            if (!hasHtmlFileInfos) {
                for (const item of dataTransfer.items) {
                    if (item.kind !== "file") continue;

                    fileInfos.push({
                        type: "UploadFile",
                        input: {type: "File", file: assertExists(item.getAsFile())},
                    });
                }
            }

            return events.addFiles("<MessageInput> drop files", fileInfos);
        },
    });

    useImperativeHandle(
        ref,
        () => ({
            isFocused: () => assertExists(editorRef.current).isFocused(),
            focus: options => assertExists(editorRef.current).focus(options),
            blur: () => assertExists(editorRef.current).blur(),
            isEmpty: () => isContentEmpty(assertExists(editorRef.current).getState().getDoc()),
            clear: events.clear,
            getBoundingClientRect: () => assertExists(inputRef.current).getBoundingClientRect(),
            drop: events.drop,
        }),
        [events],
    );

    const isEditingMessage = !!messageEditingForThisInput;

    const parent = !isEditingMessage ? parentProp : null;

    const onBeforeFocusFromReplyOrEditingChange = useEvent(
        onBeforeFocusFromReplyOrEditingChangeProp,
    );

    // Focus the message input whenever the message we're replying to changes. Or
    // if we start editing the message.
    let focusKey: string | null = null;

    if (isEditingMessage) {
        focusKey = `Editing:${messageEditingForThisInput.state.messageIndex}`;
    } else if (parent) {
        switch (parent.type) {
            case "Message": {
                focusKey = `Replying:${parent.message.index}`;
                break;
            }
            case "MessagesRange": {
                focusKey = `Replying:${parent.startIndex},${parent.endIndex},${parent.startVersion},${parent.endVersion},${parent.startPos},${parent.endPos}`;
                break;
            }
            case "PostRange": {
                focusKey = `Replying:Post,${parent.version},${parent.startPos},${parent.endPos}`;
                break;
            }
            default:
                throw exhaustive(parent);
        }
    }

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

    const isSendButtonDisabled = useMemo(
        () =>
            isSendButtonDisabledProp ||
            (!isEditingMessage &&
                isContentEmpty(trimContentEnd(state.getDoc())) &&
                files.length === 0),
        [files.length, isEditingMessage, isSendButtonDisabledProp, state],
    );

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

    const hasInitiallyMountedRef = useRef(false);
    const lastIsKeyboardToolbarVisibleRef = useRef(isKeyboardToolbarVisible);

    // On initial mount if `isKeyboardToolbarVisible` is true then make sure we set
    // the Motion Y translation variable to the correct initial value.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);

        if (isKeyboardToolbarVisible && !NativeMobileBridge) {
            void animate(
                inputElement,
                {y: [0, -mobileBottomBarKeyboardToolbarHeightRem * getRemPxWithoutListening()]},
                {duration: 0},
            );
        }
    }, [isKeyboardToolbarVisible]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastIsKeyboardToolbarVisibleRef.current === isKeyboardToolbarVisible) return;
        lastIsKeyboardToolbarVisibleRef.current = isKeyboardToolbarVisible;

        const inputElement = assertExists(inputRef.current);

        if (isKeyboardToolbarVisible) {
            if (NativeMobileBridge) {
                // Noop...
            } else {
                void animate(
                    inputElement,
                    {
                        y: [
                            0,
                            -mobileBottomBarKeyboardToolbarHeightRem * getRemPxWithoutListening(),
                        ],
                    },
                    {duration: 0.2},
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
                    {duration: 0.2},
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
        //
        // TODO(calebmer): Ideally we'd only register the bottom bar frame when the
        // input is "stuck" to the bottom of the viewport and not before that.
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
                position="relative"
                width="full"
                backgroundColor="grey-0"
                style={{
                    minHeight: !isBottomBar
                        ? messageInputMinHeightPx[platform][spacingScale]
                        : `calc(${
                              platform === "mobile"
                                  ? messageInputMinHeightPx[platform][spacingScale] +
                                    convertRemLengthToPx(
                                        mobileBottomBarKeyboardToolbarHeight,
                                        spacingScale,
                                    )
                                  : messageInputMinHeightPx[platform][spacingScale]
                          }px + var(--window-safe-area-inset-bottom, 0px))`,
                    paddingBottom: isBottomBar
                        ? clientInfo.isNativeMobile
                            ? `calc(${messageInputBottomBarBackgroundSlopBottom} + var(--window-safe-area-inset-bottom, 0px))`
                            : "var(--window-safe-area-inset-bottom, 0px)"
                        : undefined,
                    marginBottom:
                        isBottomBar && clientInfo.isNativeMobile
                            ? `-${addRemLengths(
                                  messageInputBottomBarBackgroundSlopBottom,
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
                        !editor.contains(event.target) &&
                        // Exclude clicking on files since that should open the file viewer which will
                        // close the keyboard.
                        !event.target.closest(`.${fileClassName}`)
                    ) {
                        event.preventDefault();
                    }
                }}
            >
                {(isEditingMessage || parent) && (
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        height="border"
                        // It's subtle, but `grey-5-translucent` ends up looking a lot nicer
                        // than if we used `grey-5` directly. This is because the border operates more
                        // like a shadow. When rendered over some other content (e.g. an image) the
                        // image's colors show through the border but a little darker.
                        backgroundColor="grey-5-translucent"
                        style={{
                            top: -1,
                            left: `max(-${spacing["3"]}, (100% - ${
                                spacing[contentStyles.contentMaxWidth]
                            }) / 2 - ${spacing["3"]})`,
                            right: `max(-${spacing["3"]}, (100% - ${
                                spacing[contentStyles.contentMaxWidth]
                            }) / 2 - ${spacing["3"]})`,
                            maskImage: `linear-gradient(to right, transparent, black ${spacing["3"]} calc(100% - ${spacing["3"]}), transparent)`,
                        }}
                    />
                )}
                <OverlayScopeContextProvider
                // Render an overlay scope here so that overlays are animated with the
                // keyboard opening.
                >
                    <Box
                        ref={inputContentRef}
                        width="full"
                        maxWidth={contentStyles.contentMaxWidth}
                        marginX="center"
                    >
                        {isEditingMessage && (
                            <Box
                                position="relative"
                                paddingRight={screenPaddingX}
                                paddingTop={messageInputPaddingY}
                                color="grey-80"
                                style={{
                                    // Align text with message input placeholder.
                                    paddingLeft: subtractRemLengths(
                                        addRemLengths(
                                            screenPaddingX[platform],
                                            messageInputEditorPaddingX[platform],
                                        ),
                                        "4",
                                    ),
                                }}
                            >
                                <Box display="flex" alignItems="center" gap="1" height="4">
                                    <PencilSimple size={spacing["3"]} />
                                    <span
                                        className={sprinkles({
                                            fontSize: "50",
                                            fontStyle: "truncate",
                                        })}
                                    >
                                        Editing message
                                    </span>
                                    <Box paddingLeft="0.5">
                                        <IconButton
                                            size="xs"
                                            description="Cancel editing"
                                            tooltipPlacement="top"
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
                        {parent && (
                            <MessageInputParent
                                messageNoun={messageNoun}
                                parent={parent}
                                onJumpToMessageRange={onJumpToMessageRange}
                                onJumpToPostRange={onJumpToPostRange}
                                onParentClear={onParentClear}
                                paddingX={screenPaddingX}
                            />
                        )}
                        <Box
                            paddingX={screenPaddingX}
                            paddingY={messageInputPaddingY}
                            marginX={messageInputEditorIconButtonNegativeMarginX}
                        >
                            <Box
                                position="relative"
                                zIndex="0"
                                style={{
                                    minHeight:
                                        messageInputEditorMinHeightPx[platform][spacingScale],
                                    borderRadius:
                                        messageInputEditorBorderRadiusPx[platform][spacingScale],
                                }}
                            >
                                <Box
                                    pointerEvents="none"
                                    position="absolute"
                                    zIndex="10"
                                    inset="0"
                                    border="grey-10"
                                    style={{
                                        borderRadius:
                                            messageInputEditorBorderRadiusPx[platform][
                                                spacingScale
                                            ],
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
                                    className={pointerEventsNoneNotInheritedClassName}
                                    position="absolute"
                                    left="0"
                                    bottom="0"
                                    zIndex="20"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                    style={{
                                        width: messageInputEditorMinHeightPx[platform][
                                            spacingScale
                                        ],
                                        height: messageInputEditorMinHeightPx[platform][
                                            spacingScale
                                        ],
                                    }}
                                >
                                    {platform === "mobile" ? (
                                        // On mobile, immediately open the file selector since there isn't much value
                                        // to allowing the user to select a specific file type.
                                        <IconButton
                                            size={messageInputEditorIconButtonSize}
                                            description="Add"
                                            withoutTooltip={true}
                                            // The add icon button is not focusable. That's because we don't want to
                                            // remove focus from the message input when the add button is pressed. That
                                            // way on mobile you can keep typing and sending messages because the software
                                            // keyboard doesn't disappear.
                                            //
                                            // On desktop, hitting enter in the message input is sufficient for keyboard
                                            // control of the message input.
                                            isFocusable={false}
                                            onPress={() => {
                                                selectFiles(
                                                    assertExists(inputContainerRef.current),
                                                    {
                                                        multiple: true,
                                                        // It's important to return focus before removing the temporary input element
                                                        // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                                        // finished.
                                                        onReturnFocus: () =>
                                                            editorRef.current?.focus(),
                                                    },
                                                )
                                                    .then(files => {
                                                        if (files.length === 0) return;

                                                        // Make sure we didn't unmount while selecting files.
                                                        if (!isMounted()) return;

                                                        events.addFiles(
                                                            "<MessageInput> insert files",
                                                            files.map(file => ({
                                                                type: "UploadFile",
                                                                input: {type: "File", file},
                                                            })),
                                                        );
                                                    })
                                                    .catch(scheduleUncaughtError);
                                            }}
                                        >
                                            <Plus />
                                        </IconButton>
                                    ) : (
                                        <MenuButton
                                            withoutButtonElementRequirement={true}
                                            // Generally since the message input is at the bottom of the screen the add
                                            // menu opens above the input. Let's make that pattern consistent.
                                            placement="top-start"
                                            actions={[
                                                {
                                                    label: "Image",
                                                    icon: <Image />,
                                                    onPress: () => {
                                                        selectFiles(
                                                            assertExists(inputContainerRef.current),
                                                            {
                                                                multiple: true,
                                                                acceptContentTypes:
                                                                    getFileImageContentTypes(),
                                                                // It's important to return focus before removing the temporary input element
                                                                // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                                                // finished.
                                                                onReturnFocus: () =>
                                                                    editorRef.current?.focus(),
                                                            },
                                                        )
                                                            .then(files => {
                                                                if (files.length === 0) return;

                                                                // Make sure we didn't unmount while selecting files.
                                                                if (!isMounted()) return;

                                                                events.addFiles(
                                                                    "<MessageInput> insert files",
                                                                    files.map(file => ({
                                                                        type: "UploadFile",
                                                                        input: {type: "File", file},
                                                                    })),
                                                                );
                                                            })
                                                            .catch(scheduleUncaughtError);
                                                    },
                                                },
                                                {
                                                    label: "Video",
                                                    icon: <VideoIcon />,
                                                    onPress: () => {
                                                        selectFiles(
                                                            assertExists(inputContainerRef.current),
                                                            {
                                                                multiple: true,
                                                                acceptContentTypes:
                                                                    getFileVideoContentTypes(),
                                                                // It's important to return focus before removing the temporary input element
                                                                // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                                                // finished.
                                                                onReturnFocus: () =>
                                                                    editorRef.current?.focus(),
                                                            },
                                                        )
                                                            .then(files => {
                                                                if (files.length === 0) return;

                                                                // Make sure we didn't unmount while selecting files.
                                                                if (!isMounted()) return;

                                                                events.addFiles(
                                                                    "<MessageInput> insert files",
                                                                    files.map(file => ({
                                                                        type: "UploadFile",
                                                                        input: {type: "File", file},
                                                                    })),
                                                                );
                                                            })
                                                            .catch(scheduleUncaughtError);
                                                    },
                                                },
                                                {
                                                    label: "Audio",
                                                    icon: <WaveformIcon />,
                                                    onPress: () => {
                                                        selectFiles(
                                                            assertExists(inputContainerRef.current),
                                                            {
                                                                multiple: true,
                                                                acceptContentTypes:
                                                                    getFileAudioContentTypes(),
                                                                // It's important to return focus before removing the temporary input element
                                                                // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                                                // finished.
                                                                onReturnFocus: () =>
                                                                    editorRef.current?.focus(),
                                                            },
                                                        )
                                                            .then(files => {
                                                                if (files.length === 0) return;

                                                                // Make sure we didn't unmount while selecting files.
                                                                if (!isMounted()) return;

                                                                events.addFiles(
                                                                    "<MessageInput> insert files",
                                                                    files.map(file => ({
                                                                        type: "UploadFile",
                                                                        input: {type: "File", file},
                                                                    })),
                                                                );
                                                            })
                                                            .catch(scheduleUncaughtError);
                                                    },
                                                },
                                                {
                                                    label: "File",
                                                    icon: <File />,
                                                    onPress: () => {
                                                        selectFiles(
                                                            assertExists(inputContainerRef.current),
                                                            {
                                                                multiple: true,
                                                                // It's important to return focus before removing the temporary input element
                                                                // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                                                // finished.
                                                                onReturnFocus: () =>
                                                                    editorRef.current?.focus(),
                                                            },
                                                        )
                                                            .then(files => {
                                                                if (files.length === 0) return;

                                                                // Make sure we didn't unmount while selecting files.
                                                                if (!isMounted()) return;

                                                                events.addFiles(
                                                                    "<MessageInput> insert files",
                                                                    files.map(file => ({
                                                                        type: "UploadFile",
                                                                        input: {type: "File", file},
                                                                    })),
                                                                );
                                                            })
                                                            .catch(scheduleUncaughtError);
                                                    },
                                                },
                                            ]}
                                        >
                                            <IconButton
                                                size={messageInputEditorIconButtonSize}
                                                description="Add"
                                                withoutTooltip={true}
                                                // The add icon button is not focusable. That's because we don't want to
                                                // remove focus from the message input when the add button is pressed. That
                                                // way on mobile you can keep typing and sending messages because the software
                                                // keyboard doesn't disappear.
                                                //
                                                // On desktop, hitting enter in the message input is sufficient for keyboard
                                                // control of the message input.
                                                isFocusable={false}
                                            >
                                                <Plus />
                                            </IconButton>
                                        </MenuButton>
                                    )}
                                </Box>
                                <FocusRing offset="border" isVisibleWhenFocusWithin={true}>
                                    <Box
                                        ref={useScrollbar({
                                            insetTop:
                                                messageInputEditorBorderRadiusPx[platform][
                                                    spacingScale
                                                ],
                                            // Don't overlap the send button which is rendered at the bottom of
                                            // the input.
                                            insetBottom:
                                                messageInputEditorMinHeightPx[platform][
                                                    spacingScale
                                                ],
                                            // An additional pixel of inset right to offset the inset 1px border.
                                            insetRight: 1,
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
                                        style={{
                                            borderRadius:
                                                messageInputEditorBorderRadiusPx[platform][
                                                    spacingScale
                                                ],
                                            minHeight:
                                                messageInputEditorMinHeightPx[platform][
                                                    spacingScale
                                                ],
                                        }}
                                    >
                                        <ContentBlockWidthContextProvider
                                            maxWidth={contentStyles.contentMaxWidth}
                                            paddingX={addRemLengths(
                                                screenPaddingX[platform],
                                                messageViewMarginLeft,
                                            )}
                                        >
                                            <ContentEditor
                                                ref={editorRef}
                                                state={state}
                                                onChange={(state, transaction) => {
                                                    onChange(state, transaction);
                                                    if (transaction.docChanged)
                                                        showTypingIndicator();
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
                                                style={{
                                                    paddingTop:
                                                        messageInputEditorPaddingYPx[platform][
                                                            spacingScale
                                                        ],
                                                    paddingBottom:
                                                        messageInputEditorPaddingYPx[platform][
                                                            spacingScale
                                                        ],
                                                    paddingLeft:
                                                        messageInputEditorPaddingX[platform],
                                                    paddingRight:
                                                        messageInputEditorPaddingX[platform],
                                                    borderRadius:
                                                        messageInputEditorBorderRadiusPx[platform][
                                                            spacingScale
                                                        ],
                                                }}
                                                onEnterKeyDownFromPhysicalKeyboard={event => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    onSend();
                                                }}
                                                onArrowUpKeyDown={onArrowUpKeyDown}
                                                onPasteOrDropFiles={fileInfos => {
                                                    events.addFiles(
                                                        "<MessageInput> paste files",
                                                        fileInfos,
                                                    );
                                                }}
                                                // Don't render the default content editor mobile keyboard toolbar. We render
                                                // our own `<MessageInputMobileKeyboardToolbar>` outside of the content editor.
                                                withoutMobileKeyboardToolbar={true}
                                                // Message input is always editable, never interactive on mobile. So you can't
                                                // click links among other things.
                                                withoutMobileDualModality={true}
                                            />
                                        </ContentBlockWidthContextProvider>
                                    </Box>
                                </FocusRing>
                                <Box
                                    className={pointerEventsNoneNotInheritedClassName}
                                    position="absolute"
                                    right="0"
                                    bottom="0"
                                    zIndex="20"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                    style={{
                                        width: messageInputEditorMinHeightPx[platform][
                                            spacingScale
                                        ],
                                        height: messageInputEditorMinHeightPx[platform][
                                            spacingScale
                                        ],
                                    }}
                                >
                                    <IconButton
                                        size={messageInputEditorIconButtonSize}
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
                        {files.length > 0 && (
                            <Box
                                style={{
                                    paddingLeft: subtractRemLengths(
                                        screenPaddingX[platform],
                                        messageInputFilesOverflowGradientWidth,
                                    ),
                                    paddingRight: subtractRemLengths(
                                        screenPaddingX[platform],
                                        messageInputFilesOverflowGradientWidth,
                                    ),
                                }}
                            >
                                <Box position="relative" zIndex="0" width="full" marginTop="-2">
                                    <Box
                                        position="absolute"
                                        zIndex="10"
                                        top="0"
                                        bottom="0"
                                        left="0"
                                        width={messageInputFilesOverflowGradientWidth}
                                        style={{
                                            background: `linear-gradient(to right, ${backgroundColorVar}, transparent)`,
                                        }}
                                    />
                                    <Box
                                        position="absolute"
                                        zIndex="10"
                                        top="0"
                                        bottom="0"
                                        right="0"
                                        width={messageInputFilesOverflowGradientWidth}
                                        style={{
                                            background: `linear-gradient(to left, ${backgroundColorVar}, transparent)`,
                                        }}
                                    />
                                    <Box
                                        data-scrollbar="false"
                                        position="relative"
                                        zIndex="0"
                                        width="full"
                                        overflowX="auto"
                                    >
                                        <Box
                                            display="flex"
                                            gap="2"
                                            paddingTop="2"
                                            paddingX={messageInputFilesOverflowGradientWidth}
                                            paddingBottom={messageInputPaddingY}
                                            style={{width: "fit-content"}}
                                        >
                                            {files.map(file =>
                                                file.type === "FileEntity" ? (
                                                    <MessageInputFileEntityPreview
                                                        key={file.key}
                                                        fileEntityId={file.fileEntityId}
                                                        fileEntityResult={file.fileEntityResult}
                                                        onRemove={() => onRemoveFile?.(file.key)}
                                                    />
                                                ) : (
                                                    <MessageInputFilePreview
                                                        key={file.key}
                                                        signedUrlSearch={file.signedUrlSearch}
                                                        file={file.file}
                                                        attachmentTarget={file.attachmentTarget}
                                                        onRemove={() => onRemoveFile?.(file.key)}
                                                    />
                                                ),
                                            )}
                                        </Box>
                                    </Box>
                                </Box>
                            </Box>
                        )}
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

function MessageInputParent<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun,
    parent,
    onJumpToMessageRange,
    onJumpToPostRange,
    onParentClear,
    paddingX,
}: {
    messageNoun: string;
    parent: MessageContentPayloadParentWithMessages<RoomKey, Message>;
    onJumpToMessageRange:
        | ((options: {
              roomKey: RoomKey;
              startIndex: number;
              endIndex: number;
              start: {version: number; pos: number} | null;
              end: {version: number; pos: number} | null;
          }) => void)
        | undefined;
    onJumpToPostRange:
        | ((options: {postId: PostId; version: number; startPos: number; endPos: number}) => void)
        | undefined;
    onParentClear: (() => void) | undefined;
    paddingX: Spacing | {desktop: Spacing; mobile: Spacing};
}) {
    const platform = usePlatform();
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
                                startVersion: parent.startVersion,
                                startPos: parent.startPos,
                                endVersion: parent.endVersion,
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
                                version: parent.version,
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
    const parentAccountAvatarSizeRem = parseRemLength(messageViewParentAccountAvatarSize);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            switch (parent.type) {
                case "Message": {
                    onJumpToMessageRange?.({
                        roomKey: parent.message.getRoomKey(),
                        startIndex: parent.message.index,
                        endIndex: parent.message.index,
                        start: null,
                        end: null,
                    });
                    break;
                }
                case "MessagesRange": {
                    onJumpToMessageRange?.({
                        roomKey: parent.messages[0].getRoomKey(),
                        startIndex: parent.startIndex,
                        endIndex: parent.endIndex,
                        start: {version: parent.startVersion, pos: parent.startPos},
                        end: {version: parent.endVersion, pos: parent.endPos},
                    });
                    break;
                }
                case "PostRange": {
                    onJumpToPostRange?.({
                        postId: parent.post.id,
                        version: parent.version,
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
        <Box
            data-testid={process.env.NODE_ENV !== "production" ? "MessageInputParent" : undefined}
            paddingRight={paddingX}
            style={{
                paddingTop: spacing[messageInputPaddingY[platform]],
                // Align text with message input placeholder.
                paddingLeft: `${
                    parseRemLength(
                        addRemLengths(
                            typeof paddingX !== "string" ? paddingX[platform] : paddingX,
                            messageViewAccountAvatarSize,
                        ),
                    ) + parentMessageOffsetRem
                }rem`,
            }}
        >
            <Box position="relative">
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
                            messageViewParentAvatarOffsetYRem + parentAccountAvatarSizeRem / 2
                        }rem - 1px)`,
                        bottom: `calc(-${spacing[messageInputPaddingY[platform]]} + 2px)`,
                        left: `calc(-${
                            accountAvatarSizeRem / 2 + parentMessageOffsetRem
                        }rem - 1px)`,
                        width: `calc(${
                            accountAvatarSizeRem / 2 + parentMessageOffsetRem
                        }rem - 2px)`,
                    }}
                />
                <Box display="flex" gap="1.5">
                    <Box
                        {...pressProps}
                        // This is a simulated link. When the user clicks on it our code navigates us
                        // to the right message instead of relying on browser URL navigation.
                        //
                        // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                        role="link"
                        // `inline-flex` instead of `flex` so that the clickable area doesn't extend
                        // full width when we have a short message.
                        display="inline-flex"
                        gap="1.5"
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
                        maxWidth="full"
                    >
                        <Box
                            className={sprinkles({
                                flexShrink: "0",
                                position: "relative",
                                height: "0",
                                opacity: isPressed ? "60" : "100",
                            })}
                            style={{
                                top: `${messageViewParentAvatarOffsetYRem}rem`,
                            }}
                        >
                            <AccountAvatar
                                size={messageViewParentAccountAvatarSize}
                                account={author}
                            />
                        </Box>
                        <Box
                            overflow="hidden"
                            color="grey-80"
                            fontSize={messageViewParentFontSize}
                            fontStyle="normal"
                            opacity={isPressed ? "60" : "100"}
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
                            <AccountShortName account={author} />: {truncatedContent}
                        </Box>
                    </Box>
                    <Box
                        flexShrink="0"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        // Optically center the "x" button with the send button when it's placed all
                        // the way on the right.
                        paddingRight="0.5"
                        style={{
                            height: messageViewParentLineHeightPx[spacingScale],
                        }}
                    >
                        <IconButton
                            size="xs"
                            description="Cancel reply"
                            tooltipPlacement="top"
                            onPress={onParentClear}
                            // Not focusable so clicking on this button doesn't unfocus
                            // the input.
                            isFocusable={false}
                        >
                            <X />
                        </IconButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
