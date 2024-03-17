import {ArrowBendUpLeft, Copy, Link as LinkIcon, PencilSimple, Trash} from "phosphor-react";
import {useCallback, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {writeContentToClipboard} from "~/client/content/write_content_to_clipboard.js";
import {Box} from "~/client/design/box.js";
import {Menu, MenuAction} from "~/client/design/menu_button.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {Spacer} from "~/client/design/spacer.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {
    messageViewActionsWidth,
    messageViewBubbleMinWidth,
} from "~/client/messaging/message_view.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
} from "~/shared/messaging/messaging_shared_styles.js";
import {
    colorSchemeVars,
    messagingStyles,
    overlayAnimateFadeInFromBottomSlowedAnimation,
    overlayAnimateFadeOutFromBottomAnimation,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

// NOCOMMIT:
//
// - Emoji messages
// - Replies
// - Links
// - Translate if offscreen

export function MessageViewTouchLightbox<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    messageNoun,
    messageStartOfSentenceNoun,
    message,
    messageTop,
    shouldMergeWithNextMessage,
    shouldMergeWithPreviousMessage,
    onReplyToMessage,
    onShowDeleteConfirmationDialog,
    getMessageUrl,
    onClose: onCloseWithoutAnimationProp,
}: {
    messageNoun: string;
    messageStartOfSentenceNoun: string;
    message: Message | OptimisticMessageModel;
    messageTop: number;
    shouldMergeWithNextMessage: boolean;
    shouldMergeWithPreviousMessage: boolean;
    onReplyToMessage: () => void;
    onShowDeleteConfirmationDialog: () => void;
    getMessageUrl: (messageIndex: number) => URL;
    onClose: () => void;
}) {
    const rootPortalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can't server render `<MessageViewTouchLightbox>`",
    );

    const backdropRef = useRef<HTMLDivElement>(null);
    const messageRef = useRef<HTMLDivElement>(null);

    const [isInitialPaint, setIsInitialPaint] = useState(true);
    useEffect(() => {
        if (!isInitialPaint) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsInitialPaint(false);
            });
        });
    }, [isInitialPaint]);

    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithAnimation = () => setIsFadingOut(true);
    const onCloseWithoutAnimation = useEvent(onCloseWithoutAnimationProp);

    useEffect(() => {
        if (!isFadingOut) return;

        const timeout = createTimeout(
            onCloseWithoutAnimation,
            messagingStyles.backdropFadeAnimationDurationMs,
        );

        return () => {
            timeout.clear();
        };
    }, [isFadingOut, onCloseWithoutAnimation]);

    // Our blur can't cover the tab bar (which is rendered in native code) so
    // disable the tab bar while the lightbox is open.
    useEffect(() => {
        NativeMobileBridge?.tabBar.disable({isAnimated: true});
        return () => {
            NativeMobileBridge?.tabBar.enable({isAnimated: true});
        };
    }, []);

    const [isEditing, setIsEditing] = useState(false);

    useScrollToAvoidBottomBarsAndMobileKeyboard(backdropRef, {
        isPinned: true,
        getAnchorPosition: useCallback(() => {
            const messageElement = assertExists(messageRef.current);
            return messageElement.getBoundingClientRect();
        }, []),
    });

    return createPortal(
        <Box
            ref={backdropRef}
            position="fixed"
            inset="0"
            overflow="hidden"
            className={
                !isFadingOut
                    ? messagingStyles.backdropFadeInClassName
                    : messagingStyles.backdropFadeOutClassName
            }
            onPointerDown={event => {
                if (event.target === event.currentTarget) {
                    onCloseWithAnimation();
                }
            }}
        >
            <Box
                position="absolute"
                paddingX="4"
                style={{
                    top: messageTop,
                    paddingBottom: `calc(${spacing["4"]} + var(--safe-area-inset-bottom, 0px))`,
                }}
                className={pointerEventsNoneNotInheritedClassName}
            >
                <Box display="flex" className={pointerEventsNoneNotInheritedClassName}>
                    <Box pointerEvents="none" flexShrink="0" paddingRight="2">
                        <Spacer space="7" />
                    </Box>
                    <Box
                        ref={messageRef}
                        position="relative"
                        zIndex="20"
                        backgroundColor={isEditing && !isFadingOut ? "grey-0" : "grey-5"}
                        maxWidth="full"
                        overflow="hidden"
                        display="inline-block"
                        paddingX={messageViewBubblePaddingX}
                        paddingY={messageViewBubblePaddingY}
                        borderTopLeftRadius={
                            isInitialPaint || isFadingOut
                                ? !shouldMergeWithPreviousMessage
                                    ? messageViewBubbleBorderRadius
                                    : messageViewBubbleMergedBorderRadius
                                : messageViewBubbleBorderRadius
                        }
                        borderTopRightRadius={messageViewBubbleBorderRadius}
                        borderBottomLeftRadius={
                            isInitialPaint || isFadingOut
                                ? !shouldMergeWithNextMessage
                                    ? messageViewBubbleBorderRadius
                                    : messageViewBubbleMergedBorderRadius
                                : messageViewBubbleBorderRadius
                        }
                        borderBottomRightRadius={messageViewBubbleBorderRadius}
                        pointerEvents="auto"
                        style={{
                            transform: `translateX(-${
                                isInitialPaint || isFadingOut ? "0rem" : spacing["9"]
                            })`,
                            transition: `transform 200ms 50ms ease, border-radius 200ms 50ms ease`,
                            boxShadow:
                                isEditing && !isFadingOut
                                    ? `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`
                                    : undefined,
                        }}
                    >
                        {isEditing && !isFadingOut ? (
                            <MessageViewTouchLightboxContentEditor
                                messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                initialContent={
                                    message.payload.type === "Content"
                                        ? message.payload.content
                                        : emptyMessageContentWithReferences
                                }
                            />
                        ) : (
                            <ContentView
                                isInert={true}
                                withUserSelectNone={true}
                                className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                                content={
                                    // Should only be able to open a lightbox for a message with content. If a
                                    // message is deleted then show nothing. (Message may be deleted in realtime.)
                                    message.payload.type === "Content"
                                        ? message.payload.content
                                        : emptyMessageContentWithReferences
                                }
                                contentUpdatedTime={
                                    message.payload.type === "Content"
                                        ? message.payload.contentUpdatedTime
                                        : message.payload.deletedTime
                                }
                            />
                        )}
                    </Box>
                    <Box pointerEvents="none" flexShrink="0" paddingLeft="3">
                        <Box width={messageViewActionsWidth} />
                    </Box>
                </Box>
                {!isEditing && (
                    <Box
                        // Display flex so we don't get the same width as the message bubble.
                        display="flex"
                        paddingTop={defaultTooltipOffset}
                        className={pointerEventsNoneNotInheritedClassName}
                        style={{
                            animation: !isFadingOut
                                ? overlayAnimateFadeInFromBottomSlowedAnimation
                                : overlayAnimateFadeOutFromBottomAnimation,
                        }}
                    >
                        <Menu
                            actions={[
                                [
                                    {
                                        label: "Reply",
                                        icon: <ArrowBendUpLeft />,
                                        iconPlacement: "end",
                                        onPress: onReplyToMessage,
                                    },
                                ],
                                [
                                    ...(message.payload.type === "Content"
                                        ? [
                                              cast<MenuAction>({
                                                  label: "Copy text",
                                                  icon: <Copy />,
                                                  iconPlacement: "end",
                                                  pressErrorTitle: `Couldn’t copy ${messageNoun} text`,
                                                  onPress: async () => {
                                                      assert(message.payload.type === "Content");

                                                      await writeContentToClipboard(
                                                          message.payload.content,
                                                      );
                                                  },
                                              }),
                                          ]
                                        : []),
                                    ...(!message.isOptimistic
                                        ? [
                                              cast<MenuAction>({
                                                  label: "Copy link",
                                                  icon: <LinkIcon />,
                                                  iconPlacement: "end",
                                                  pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
                                                  onPress: async () => {
                                                      await writeTextToClipboard(
                                                          getMessageUrl(message.index).toString(),
                                                      );
                                                  },
                                              }),
                                          ]
                                        : []),
                                ],
                                [
                                    ...(!message.isOptimistic && message.payload.type === "Content"
                                        ? [
                                              cast<MenuAction>({
                                                  label: "Edit",
                                                  icon: <PencilSimple />,
                                                  iconPlacement: "end",
                                                  // Engages editing within the lightbox when pressed. We'll hide the menu but
                                                  // want to keep the lightbox open.
                                                  shouldNotCloseAfterPress: true,
                                                  onPress: () => {
                                                      setIsEditing(true);
                                                  },
                                              }),
                                          ]
                                        : []),
                                    {
                                        label: "Delete",
                                        icon: <Trash />,
                                        iconPlacement: "end",
                                        onPress: onShowDeleteConfirmationDialog,
                                    },
                                ],
                            ]}
                            onCloseWithAnimation={onCloseWithAnimation}
                            // Always close lightbox with animation.
                            onCloseWithoutAnimation={onCloseWithAnimation}
                        />
                    </Box>
                )}
            </Box>
        </Box>,
        rootPortalElement,
    );
}

function MessageViewTouchLightboxContentEditor({
    messageStartOfSentenceNoun,
    initialContent,
}: {
    messageStartOfSentenceNoun: string;
    initialContent: MessageContentWithReferences;
}) {
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const [state, setState] = useState(
        ContentEditorState.create(initialContent, {
            // Our lightbox content editor starts the selection at the end instead of
            // selecting all content since on touch devices changing a selection from the
            // entire input can be tricky.
            selectionAt: "end",
        }),
    );

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const editor = assertExists(editorRef.current);
        editor.focus({preventScroll: true});
    }, []);

    return (
        <ContentEditor
            ref={editorRef}
            state={state}
            onChange={setState}
            aria-label={messageStartOfSentenceNoun}
            // With no content the message bubble will be at its min-width so only render
            // an en-dash as a placeholder.
            placeholder={"\u2013"}
            // On mobile, don't allow interactions when unfocused. We're already in an
            // editing modality.
            withoutMobileDualModality={true}
            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
            onEscape={event => {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
            }}
            onEnterFromPhysicalKeyboard={event => {
                event.preventDefault();
                event.stopPropagation();
                onSave();
            }}
        />
    );
}
