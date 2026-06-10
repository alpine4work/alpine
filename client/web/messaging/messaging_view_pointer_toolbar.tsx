import {useHover, usePress} from "@react-aria/interactions";
import classNames from "classnames";
import {ArrowArcRight, IconContext} from "phosphor-react";
import {Memo, ReactNode, Ref, RefObject, forwardRef, useEffect, useRef, useState} from "react";
import {mergeProps} from "react-aria";
import {flushSync} from "react-dom";
import {getContentViewPosFromDom} from "~/client/web/content/get_content_view_pos_from_dom.js";
import {isMessagingViewPointerToolbarAnimationOutDisabled} from "~/client/web/content/messaging/disable_messaging_view_pointer_toolbar_animation_out_until_after_next_animation_frame.js";
import {Box} from "~/client/web/design/box.js";
import {useIsContextMenuOpen} from "~/client/web/design/context_menu.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {
    subscribeToTriggeredOverlayCloseEvent,
    subscribeToTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {getSelectionStartNodeAndEndNode} from "~/client/web/helpers/get_selection_start_node_and_end_node.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {shouldMergeMessages} from "~/client/web/messaging/internal/should_merge_messages.js";
import {useMessagingViewToolbarReactionState} from "~/client/web/messaging/internal/use_messaging_view_toolbar_reaction_state.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    deleteMessageReactionWithOptimisticUpdate,
    setMessageReactionWithOptimisticUpdate,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {
    CurrentAccountReactionButtonIcon,
    ReactionButtonBase,
} from "~/client/web/reactions/reaction_button.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    messagingStyles,
    sprinkles,
    withoutClearSelectionOnMouseDownClassName,
} from "~/client/web/styles/styles.js";
import {VirtualizedScrollViewRef} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {finallyMaybePromise} from "~/shared/helpers/async/finally_maybe_promise.js";
import {isPromiseLike} from "~/shared/helpers/async/is_promise_like.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayloadMessagesRangeParent,
    MessageContentPayloadParent,
    MessageContentPayloadPostRangeParent,
} from "~/shared/messaging/message_schema.js";

export function MessagingViewPointerToolbar<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    viewRef,
    messageNoun,
    getMessagesByRoomKey,
    getPostByRoomKey = null,
    onReplyToMessagesRange,
    onSetMessageReaction,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef | null>;
    messageNoun: string;
    getMessagesByRoomKey: Memo<(roomKey: string) => MessageList<Message> | null>;
    getPostByRoomKey?: Memo<(roomKey: string) => PostModel | null> | null;
    onReplyToMessagesRange: (
        roomKey: RoomKey,
        parent: Extract<MessageContentPayloadParent, {type: "MessagesRange" | "PostRange"}>,
    ) => MaybePromise<void>;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<
        <PromiseValue>(
            roomKey: RoomKey,
            promise: Promise<PromiseValue>,
            update: (
                messages: MessageList<Message>,
                promiseValue: PromiseValue | undefined,
            ) => MessageList<Message>,
        ) => void
    >;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const platform = usePlatform();
    const reporter = useReporter();
    const {currentAccount} = useSpaceContext();
    const isContextMenuOpen = useIsContextMenuOpen();
    const inboxContext = useInboxContext();

    const toolbarRef = useRef<HTMLDivElement>(null);

    // If set to `null` then we hide the toolbar without animation. If `isVisible` is
    // set to false then we animate out using the location from `coords`.
    const [state, setState] = useState<MessagingViewPointerToolbarState<RoomKey> | null>(null);

    useEffect(() => {
        if (isInitialAppRender) return;
        if (platform === "mobile") return;

        const view = assertExists(viewRef.current);

        const handleSelectionChange = (event?: Event) => {
            const state = getMessagingViewPointerToolbarState<RoomKey, Message>(
                view,
                getMessagesByRoomKey,
                getPostByRoomKey,
            );

            if (event?.type !== "selectionchange") {
                setState(state);
            } else {
                const disableAnimationOut = isMessagingViewPointerToolbarAnimationOutDisabled();

                setState(previousState => {
                    if (!state) {
                        if (!previousState) {
                            return previousState;
                        } else {
                            return {...previousState, isVisible: false, disableAnimationOut};
                        }
                    } else {
                        return state;
                    }
                });
            }
        };

        handleSelectionChange();

        document.addEventListener("selectionchange", handleSelectionChange);
        window.addEventListener("resize", handleSelectionChange);
        return () => {
            document.removeEventListener("selectionchange", handleSelectionChange);
            window.removeEventListener("resize", handleSelectionChange);
        };
    }, [getMessagesByRoomKey, getPostByRoomKey, isInitialAppRender, platform, viewRef]);

    const reactionState = useMessagingViewToolbarReactionState({
        state,
        getMessagesByRoomKey,
    });

    // NOTE(calebmer): This state is copied from `<ContentEditorPointerToolbar>`.
    {
        // If the pointer has moved while pressing down and the user has some text
        // selected, the user is probably trying to drag to change their selection. If they
        // are dragging then we don't want to show the toolbar since it won't have much
        // use. They can't click anything in the toolbar until they release anyway.
        //
        // If we show the toolbar while dragging it jumps around awkwardly and blocks
        // pointer events from the mouse over content the user is potentially dragging to.
        const [hasPointerMovedWhileDown, setHasPointerMovedWhileDown] = useState(false);

        const [
            isWaitingForTripleClickAfterDoubleClick,
            setIsWaitingForTripleClickAfterDoubleClick,
        ] = useState(false);

        useEffect(() => {
            if (!isWaitingForTripleClickAfterDoubleClick) return;

            const timeout = createTimeout(() => {
                setIsWaitingForTripleClickAfterDoubleClick(false);
            }, doubleClickDelayMs);

            return () => timeout.clear();
        }, [isWaitingForTripleClickAfterDoubleClick]);

        useLayoutEffectWithoutServerSideWarning(() => {
            let isPointerDownOutsideToolbar = false;

            let lastMouseDownTime1: number | null = null;
            let lastMouseDownTime2: number | null = null;

            const handlePointerDown = (event: PointerEvent) => {
                isPointerDownOutsideToolbar = !(
                    event.target instanceof Node && toolbarRef.current?.contains(event.target)
                );
                setHasPointerMovedWhileDown(false);

                if (
                    event.pointerType === "mouse" &&
                    // Ignore clicks inside of our toolbar for triple click detection purposes.
                    !(event.target instanceof Node && toolbarRef.current?.contains(event.target))
                ) {
                    const mouseDownTime = Date.now();

                    if (
                        lastMouseDownTime1 !== null &&
                        mouseDownTime - lastMouseDownTime1 <= doubleClickDelayMs
                    ) {
                        if (
                            lastMouseDownTime2 === null ||
                            lastMouseDownTime1 - lastMouseDownTime2 > doubleClickDelayMs
                        ) {
                            setIsWaitingForTripleClickAfterDoubleClick(true);
                        } else {
                            setIsWaitingForTripleClickAfterDoubleClick(false);
                        }
                    }

                    lastMouseDownTime2 = lastMouseDownTime1;
                    lastMouseDownTime1 = mouseDownTime;
                }
            };

            const handlePointerMove = () => {
                if (isPointerDownOutsideToolbar) {
                    setHasPointerMovedWhileDown(true);
                }

                // If the pointer moves, triple click chances are cancelled.
                setIsWaitingForTripleClickAfterDoubleClick(false);
            };

            const handlePointerUp = () => {
                isPointerDownOutsideToolbar = false;
                setHasPointerMovedWhileDown(false);
            };

            const handlePointerCancel = () => {
                isPointerDownOutsideToolbar = false;
                setHasPointerMovedWhileDown(false);
            };

            const handleDragStart = () => {
                isPointerDownOutsideToolbar = false;
                setHasPointerMovedWhileDown(false);
            };

            document.addEventListener("pointerdown", handlePointerDown, true);
            document.addEventListener("pointermove", handlePointerMove, true);
            document.addEventListener("pointerup", handlePointerUp, true);
            document.addEventListener("pointercancel", handlePointerCancel, true);
            document.addEventListener("dragstart", handleDragStart, true);
            return () => {
                document.removeEventListener("pointerdown", handlePointerDown, true);
                document.removeEventListener("pointermove", handlePointerMove, true);
                document.removeEventListener("pointerup", handlePointerUp, true);
                document.removeEventListener("pointercancel", handlePointerCancel, true);
                document.removeEventListener("dragstart", handleDragStart, true);
            };
        }, []);

        // Don't show the toolbar if the user's pointer is dragging to select text.
        if (hasPointerMovedWhileDown) return null;

        // If the user has double clicked (to select a word) then we wait to see if they
        // triple click (to select a paragraph) before showing the pointer toolbar.
        // Otherwise it looks a little glitchy to see the toolbar appear then immediately
        // jump to the beginning of the paragraph.
        if (isWaitingForTripleClickAfterDoubleClick) return null;
    }

    if (!state) return null;

    // Don't show toolbar if context menu is open.
    if (isContextMenuOpen) return null;

    const hideToolbar = () => {
        // Immediately hide the toolbar without animation after the reply to message range
        // call finishes.
        flushSync(() => {
            setState({
                ...state,
                isVisible: false,
                disableAnimationOut: true,
            });
        });

        // Remove the selection immediately in the same frame we close the pointer toolbar
        // (closing the pointer toolbar will be this frame because we used `flushSync()`
        // above). Instead of waiting for the message input to be focused (which may be
        // rendered on another frame).
        window.getSelection()?.removeAllRanges();
    };

    if (!currentAccount) return null;

    return (
        <OverlayAnimated
            isVisible={state.isVisible}
            disableAnimationOut={state.disableAnimationOut}
            placement="top-start"
            // The pointer toolbar needs to flip to the bottom if it would otherwise conflict
            // with the navigation bar. For example, try opening a post view on desktop then
            // editing the post, then selecting text at the top of the post. The toolbar needs
            // to flip down.
            fallbackPlacements={["bottom-start"]}
            offset="2.5"
            offsetAlong="-1"
            overlay={
                <Box
                    ref={toolbarRef}
                    display="flex"
                    pointerEvents={!state.isVisible ? "none" : undefined}
                    color="grey-100"
                    backgroundColor="grey-0"
                    borderRadius="1.5"
                    boxShadow="elevation-20"
                    paddingLeft="1"
                    paddingRight="0.5"
                    className={classNames(
                        greyElevated2ClassName,
                        // Don't clear the selection when clicking in the toolbar since the toolbar
                        // references the selection.
                        withoutClearSelectionOnMouseDownClassName,
                    )}
                >
                    <MessagingViewPointerToolbarButton
                        dividerRight={reactionState !== null}
                        icon={<ArrowArcRight />}
                        label="Reply"
                        onPress={() => {
                            const promise = onReplyToMessagesRange(state.roomKey, state.parent);
                            return finallyMaybePromise(promise, hideToolbar);
                        }}
                    />
                    {reactionState !== null && (
                        <ReactionButtonBase
                            withoutButtonElementRequirement={true}
                            reactions={reactionState.reactions}
                            onSetReaction={reaction => {
                                setMessageReactionWithOptimisticUpdate({
                                    reporter,
                                    currentAccountId: currentAccount.id,
                                    messageNoun,
                                    roomKey: reactionState.roomKey,
                                    messageIndex: reactionState.messageIndex,
                                    contentVersion: reactionState.contentVersion,
                                    pos: reactionState.pos,
                                    reaction,
                                    onSetMessageReaction,
                                    onUpdateMessagesOptimistically,
                                    inboxContext,
                                });

                                // Hide the toolbar after setting/deleting a reaction. Since it's hard to preserve
                                // selection state after we re-render `<ContentViewWithReactionParties>` which
                                // splits apart `<ContentView>`s. It's easier to change your reaction in the
                                // reaction party anyway.
                                hideToolbar();
                            }}
                            onDeleteReaction={() => {
                                deleteMessageReactionWithOptimisticUpdate({
                                    reporter,
                                    currentAccountId: currentAccount.id,
                                    messageNoun,
                                    roomKey: reactionState.roomKey,
                                    messageIndex: reactionState.messageIndex,
                                    contentVersion: reactionState.contentVersion,
                                    pos: reactionState.pos,
                                    onDeleteMessageReaction,
                                    onUpdateMessagesOptimistically,
                                });

                                // Hide the toolbar after setting/deleting a reaction. Since it's hard to preserve
                                // selection state after we re-render `<ContentViewWithReactionParties>` which
                                // splits apart `<ContentView>`s. It's easier to change your reaction in the
                                // reaction party anyway.
                                hideToolbar();
                            }}
                        >
                            {({currentAccountReaction, isPointerDownFromOverlayOpen}) => (
                                <MessagingViewPointerToolbarButton
                                    dividerLeft
                                    icon={
                                        <CurrentAccountReactionButtonIcon
                                            currentAccountReaction={currentAccountReaction}
                                            isPressed={isPointerDownFromOverlayOpen}
                                        />
                                    }
                                    label={
                                        <PrettyNumber number={reactionState.reactions.get().size} />
                                    }
                                    isPressed={isPointerDownFromOverlayOpen}
                                />
                            )}
                        </ReactionButtonBase>
                    )}
                </Box>
            }
        >
            <div
                style={{
                    pointerEvents: "none",
                    position: "absolute",
                    left: state.coords.left,
                    top: state.coords.top,
                    width: state.coords.right - state.coords.left,
                    height: state.coords.bottom - state.coords.top,
                }}
            />
        </OverlayAnimated>
    );
}

const MessagingViewPointerToolbarButton = forwardRef(function MessagingViewPointerToolbarButton(
    {
        icon,
        label,
        dividerLeft,
        dividerRight,
        isPressed: isPressedFromProps = false,
        onPress,
    }: {
        icon: ReactNode;
        label: ReactNode;
        dividerLeft?: boolean;
        dividerRight?: boolean;
        isPressed?: boolean;
        onPress?: () => MaybePromise<void>;
    },
    ref: Ref<HTMLDivElement>,
) {
    const localRef = useRef<HTMLDivElement>(null);

    const [isPending, setIsPending] = useState(false);

    const {pressProps, isPressed: isPressedFromState} = usePress({
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        ref: localRef,
        preventFocusOnPress: true,
        onPress: () => {
            if (isPending) return;

            const result = onPress?.();

            // If `onPress` returns a promise then don't allow another press until the promise
            // is resolved.
            if (isPromiseLike(result)) {
                setIsPending(true);
                void result.finally(() => setIsPending(false));
            }
        },
    });

    const isPressed = isPressedFromProps || isPressedFromState;

    const {hoverProps, isHovered} = useHover({});

    const [isTriggeredOverlayOpen, setIsTriggeredOverlayOpen] = useState(false);

    // Same logic as `<Button>` for rendering a hovered background while a triggered
    // overlay is open. Since we may use this button component as the child of
    // `<ReactionButtonBase>` we need to render a hovered background while the overlay
    // is open.
    useEffect(() => {
        const element = assertExists(localRef.current);

        const handleOverlayOpen = () => setIsTriggeredOverlayOpen(true);
        const handleOverlayClose = () => setIsTriggeredOverlayOpen(false);

        const unsubscribe1 = subscribeToTriggeredOverlayOpenEvent(element, handleOverlayOpen);
        const unsubscribe2 = subscribeToTriggeredOverlayCloseEvent(element, handleOverlayClose);

        return () => {
            unsubscribe1();
            unsubscribe2();
        };
    }, []);

    const isHoveredBackground = isHovered || isTriggeredOverlayOpen;

    return (
        <div
            {...mergeProps(pressProps, hoverProps)}
            ref={useMergedRefs(ref, localRef)}
            // Disable the ability to focus this icon button! The icon buttons in the selection
            // toolbar are only mouse accessible. They are not keyboard accessible. By being
            // focusable then the button steals focus when you click on it, so instead make the
            // button not focusable. This also makes it so the button is not reachable in tab
            // order.
            tabIndex={undefined}
            className={sprinkles({
                paddingY: "1",
                // You may notice our button doesn't have a pointer cursor. See:
                // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                cursor: "default",
            })}
        >
            <Box
                // We implement dividers in this funky way so that as the mouse scrubs left and
                // right over our toolbar the tooltips immediately disappear/reappear because there
                // is no gap in between the hovered elements.
                paddingRight={dividerRight ? "1" : "0.5"}
                borderRight={dividerRight ? "grey-5" : undefined}
                paddingLeft={dividerLeft ? "1" : undefined}
            >
                <Box
                    display="flex"
                    alignItems="center"
                    gap="1.5"
                    paddingX="1.5"
                    paddingY="1"
                    borderRadius="1"
                    color="grey-100"
                    backgroundColor={
                        isPressed ? "grey-10" : isHoveredBackground ? "grey-5" : undefined
                    }
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing["4"],
                        }}
                    >
                        {icon}
                    </IconContext.Provider>
                    <Box>{label}</Box>
                </Box>
            </Box>
        </div>
    );
});

type MessagingViewPointerToolbarStateBase = {
    readonly isVisible: boolean;
    readonly disableAnimationOut: boolean;
    readonly startContentElement: Element;
    readonly startNode: Node;
    readonly startOffset: number;
    readonly endContentElement: Element;
    readonly endNode: Node;
    readonly endOffset: number;
    readonly coords: {
        readonly top: number;
        readonly bottom: number;
        readonly left: number;
        readonly right: number;
    };
};

function getMessagingViewPointerToolbarStateBase(
    offsetParent: HTMLElement,
): MessagingViewPointerToolbarStateBase | null {
    const selection = window.getSelection();
    if (!selection || !selection.focusNode || !selection.anchorNode) return null;

    // Ignore empty selections.
    if (selection.isCollapsed) return null;

    const focusContentElement = (
        selection.focusNode instanceof Element
            ? selection.focusNode
            : selection.focusNode.parentElement
    )?.closest(`.${messagingStyles.withPointerToolbarClassName}`);

    const anchorContentElement = (
        selection.anchorNode instanceof Element
            ? selection.anchorNode
            : selection.anchorNode.parentElement
    )?.closest(`.${messagingStyles.withPointerToolbarClassName}`);

    // Selection doesn't start or end in the `<MessageView>`.
    if (!focusContentElement && !anchorContentElement) return null;

    const {
        start,
        startNode: actualStartNode,
        startOffset: actualStartOffset,
        endNode: actualEndNode,
        endOffset: actualEndOffset,
    } = getSelectionStartNodeAndEndNode({
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
    });

    const startContentElement = start === "Anchor" ? anchorContentElement : focusContentElement;

    // Make sure the element exists and that it's not inside a different messaging view
    // rendered on the page.
    if (!startContentElement) return null;
    if (!offsetParent.contains(startContentElement)) return null;

    let startNode = actualStartNode;
    let startOffset = actualStartOffset;
    let endNode = actualEndNode;
    let endOffset = actualEndOffset;

    // This case is to support when we right click on a mention and get a selection
    // where the selection starts at offset 0 in the `<a>` mention container element.
    if (!(startNode instanceof Text) && startOffset === 0) {
        let startFirstChildLeafNode: Node | null = firstChildLeafNode(startNode);
        while (
            startFirstChildLeafNode &&
            !(startFirstChildLeafNode instanceof Text) &&
            startNode.contains(startFirstChildLeafNode)
        ) {
            startFirstChildLeafNode = nextLeafNode(startFirstChildLeafNode);
        }
        if (startFirstChildLeafNode && startFirstChildLeafNode instanceof Text) {
            startNode = startFirstChildLeafNode;
            startOffset = 0;
        }
    }

    // This case is to support when we right click on a mention and get a selection
    // where the selection ends at offset 1 in the `<a>` mention container element.
    if (!(endNode instanceof Text) && endOffset > 0) {
        let endLastChildLeafNode: Node | null = lastChildLeafNode(endNode);
        while (
            endLastChildLeafNode &&
            !(endLastChildLeafNode instanceof Text) &&
            endNode.contains(endLastChildLeafNode)
        ) {
            endLastChildLeafNode = previousLeafNode(endLastChildLeafNode);
        }
        if (endLastChildLeafNode && endLastChildLeafNode instanceof Text) {
            endNode = endLastChildLeafNode;
            endOffset = endLastChildLeafNode.length;
        }
    }

    let endContentElement = start === "Anchor" ? focusContentElement : anchorContentElement;

    if (
        endContentElement &&
        // Only use the current `endNode` if the offset isn't at the very beginning. An
        // offset at the very beginning of a node isn't really a selection at all. Chrome
        // does this all the time in its underlying `Selection` format: if you triple click
        // a paragraph then the selection will end at offset 0 in the NEXT paragraph. But
        // Chrome renders this selection as if it doesn't extend beyond the paragraph!
        // `trimSelectionInvisibleExtensionIntoAdjacentNodes()` also has a good
        // documentation comment explaining this behavior.
        //
        // So if we have an `endOffset` of 0 we want to go into the `else` branch below
        // which searches backwards for a selectable text node and treats the selection as
        // ending there.
        endOffset > 0
    ) {
        // Make sure the element exists and that it's not inside a different messaging view
        // rendered on the page.
        if (!offsetParent.contains(endContentElement)) return null;
    }
    // Selection doesn't end in a `<MessageView>`.
    else {
        if (!(endNode instanceof Element)) return null;

        // If `endNode` is an element then that means the selection actually ends BEFORE
        // the element. (e.g. If you're selecting near the bottom of `<ChatView>` `endNode`
        // will be the `<MessageInput>`'s `<ContentEditor>`.) Instead of returning null,
        // try to find the previous selectable text node and check if that's in a message
        // view. If it is in a message view then we'll use it as our `endNode`.

        let previousNode = previousLeafNode(endNode);
        while (previousNode) {
            if (previousNode instanceof Text) {
                const parentComputedStyle = previousNode.parentElement
                    ? getComputedStyle(previousNode.parentElement)
                    : null;

                if (
                    (parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !==
                    "none"
                ) {
                    endNode = previousNode;
                    endOffset = previousNode.data.length;
                    break;
                }
            }
            previousNode = previousLeafNode(previousNode);
        }

        endContentElement = (endNode instanceof Element ? endNode : endNode.parentElement)?.closest(
            `.${messagingStyles.withPointerToolbarClassName}`,
        );

        // Make sure the element exists and that it's not inside a different messaging view
        // rendered on the page.
        if (!endContentElement) return null;
        if (!offsetParent.contains(endContentElement)) return null;
    }

    const range = document.createRange();

    if (startNode instanceof Text) {
        // We select one character so that if we have a selection at the start of a wrapped
        // line we get the position of the character on that wrapped line. If our range is
        // zero-width then we get a position that's split between the end of the previous
        // line and the start of the next line.
        range.setStart(startNode, startOffset);
        range.setEnd(startNode, startOffset + 1);
    }
    // If `startNode` is not a text node then find the first selectable text node after
    // `startNode` for our `range` which we use to compute the pointer toolbar
    // position.
    else {
        let nextNode = nextLeafNode(startNode);
        while (nextNode) {
            if (nextNode instanceof Text) {
                const parentComputedStyle = nextNode.parentElement
                    ? getComputedStyle(nextNode.parentElement)
                    : null;

                if (
                    (parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !==
                    "none"
                ) {
                    range.setStart(nextNode, 0);
                    range.setEnd(nextNode, 0);
                    break;
                }
            }
            nextNode = nextLeafNode(nextNode);
        }

        // Couldn't find a selectable text node after `startNode`.
        if (!nextNode) return null;
    }

    let clientRects = Array.from(range.getClientRects());

    if (endNode instanceof Text) {
        range.setStart(endNode, endOffset - 1);
        range.setEnd(endNode, endOffset);
    }
    // If `startNode` is not a text node then find the first selectable text node after
    // `startNode` for our `range` which we use to compute the pointer toolbar
    // position.
    //
    // This code path runs when the selection is in between paragraphs. Since the DOM
    // selection will have `endNode` as a `<p>` element instead of a text node inside a
    // `<p>` element.
    else {
        let previousNode = previousLeafNode(endNode);
        while (previousNode) {
            if (previousNode instanceof Text) {
                const parentComputedStyle = previousNode.parentElement
                    ? getComputedStyle(previousNode.parentElement)
                    : null;

                if (
                    (parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !==
                    "none"
                ) {
                    range.setStart(previousNode, previousNode.data.length);
                    range.setEnd(previousNode, previousNode.data.length);
                    break;
                }
            }
            previousNode = previousLeafNode(previousNode);
        }

        // Couldn't find a selectable text node after `startNode`.
        if (!previousNode) return null;
    }

    clientRects = clientRects.concat(Array.from(range.getClientRects()));

    let firstClientRect: DOMRect | null = null;
    let lastClientRect: DOMRect | null = null;

    for (const clientRect of clientRects) {
        if (
            firstClientRect === null ||
            clientRect.y < firstClientRect.y ||
            (clientRect.y === firstClientRect.y && clientRect.x <= firstClientRect.x)
        ) {
            firstClientRect = clientRect;
        }

        if (
            lastClientRect === null ||
            clientRect.y > lastClientRect.y ||
            (clientRect.y === lastClientRect.y && clientRect.x >= lastClientRect.x)
        ) {
            lastClientRect = clientRect;
        }
    }

    if (!firstClientRect || !lastClientRect) return null;

    // NOTE(calebmer): We're copying the logic from `content_editor_cursor_tracker.tsx`
    // for positioning the reply pointer toolbar. The toolbar needs to look good when
    // rendered above or below the selection.
    const coords = {
        top: Math.min(firstClientRect.top, lastClientRect.top),
        bottom: Math.max(firstClientRect.bottom, lastClientRect.bottom),
        left: Math.min(firstClientRect.left, lastClientRect.left),
        right: Math.max(firstClientRect.right, lastClientRect.right),
    };

    // `coords` are relative to the viewport, so get our offset parent's viewport rect
    // so we can correctly position our selection target in the offset parent.
    const offsetParentRect = offsetParent.getBoundingClientRect();

    return {
        isVisible: true,
        disableAnimationOut: false,
        startContentElement,
        startNode,
        startOffset,
        endContentElement,
        endNode,
        endOffset,
        coords: {
            top: coords.top - offsetParentRect.top,
            bottom: coords.bottom - offsetParentRect.top,
            left: coords.left - offsetParentRect.left,
            right: coords.right - offsetParentRect.left,
        },
    };
}

/**
 * Traverse to the next leaf node in the DOM tree.
 */
function nextLeafNode(node: Node): Node | null {
    if (node.nextSibling) {
        let childNode = node.nextSibling;
        while (childNode.firstChild) childNode = childNode.firstChild;
        return childNode;
    }

    let parentNode = node.parentNode;
    while (parentNode) {
        if (parentNode.nextSibling) {
            let childNode = parentNode.nextSibling;
            while (childNode.firstChild) childNode = childNode.firstChild;
            return childNode;
        }
        parentNode = parentNode.parentNode;
    }

    return null;
}

/**
 * Traverse to the previous leaf node in the DOM tree.
 */
function previousLeafNode(node: Node): Node | null {
    if (node.previousSibling) {
        let childNode = node.previousSibling;
        while (childNode.lastChild) childNode = childNode.lastChild;
        return childNode;
    }

    let parentNode = node.parentNode;
    while (parentNode) {
        if (parentNode.previousSibling) {
            let childNode = parentNode.previousSibling;
            while (childNode.lastChild) childNode = childNode.lastChild;
            return childNode;
        }
        parentNode = parentNode.parentNode;
    }

    return null;
}

/**
 * Traverse to the first leaf node that's a child of the provided node in the DOM
 * tree.
 */
function firstChildLeafNode(node: Node): Node {
    let childNode = node;
    while (childNode.firstChild) childNode = childNode.firstChild;
    return childNode;
}

/**
 * Traverse to the last leaf node that's a child of the provided node in the DOM
 * tree.
 */
function lastChildLeafNode(node: Node): Node {
    let childNode = node;
    while (childNode.lastChild) childNode = childNode.lastChild;
    return childNode;
}

export type MessagingViewPointerToolbarState<RoomKey extends string> =
    MessagingViewPointerToolbarStateBase & {
        readonly roomKey: RoomKey;
        readonly parent:
            | MessageContentPayloadMessagesRangeParent
            | MessageContentPayloadPostRangeParent;
    };

function getMessagingViewPointerToolbarState<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>(
    view: VirtualizedScrollViewRef,
    getMessagesByRoomKey: (roomKey: string) => MessageList<Message> | null,
    getPostByRoomKey: ((roomKey: string) => PostModel | null) | null,
): MessagingViewPointerToolbarState<RoomKey> | null {
    const offsetParent = view.getContentElement();

    const state = getMessagingViewPointerToolbarStateBase(offsetParent);
    if (state === null) return null;

    const startRoomKey = state.startContentElement.getAttribute("data-room");
    const endRoomKey = state.endContentElement.getAttribute("data-room");

    // If the messages are in different rooms then we can't reply to the range.
    if (startRoomKey === null) return null;
    if (endRoomKey === null) return null;
    if (startRoomKey !== endRoomKey) return null;

    const startIndexString = state.startContentElement.getAttribute("data-index");
    const endIndexString = state.endContentElement.getAttribute("data-index");

    if (startIndexString === null) return null;
    if (endIndexString === null) return null;

    const startIndex = parseInt(startIndexString, 10);
    const endIndex = parseInt(endIndexString, 10);

    if (isNaN(startIndex)) return null;
    if (isNaN(endIndex)) return null;

    // `startIndex` must be less than or equal to `endIndex`.
    if (startIndex > endIndex) return null;

    // If both `startIndex` and `endIndex` are -1 then we're referencing a post's
    // content so we should use the `PostRange` parent type.
    if (startIndex === -1 || endIndex === -1) {
        // Both `startIndex` and `endIndex` must be -1.
        if (startIndex !== -1 || endIndex !== -1) return null;

        if (getPostByRoomKey === null) return null;
        const postRoom = getPostByRoomKey(startRoomKey);
        if (postRoom === null) return null;

        const startPos = assertExists(
            getContentViewPosFromDom(
                state.startContentElement,
                state.startNode,
                state.startOffset,
            )?.[0],
        );

        const endPos = assertExists(
            getContentViewPosFromDom(state.endContentElement, state.endNode, state.endOffset)?.[1],
        );

        return {
            ...state,

            // Safe to consider this a `RoomKey` since `getMessagesByRoomKey()` returned a
            // non-null `MessageList` for this value.
            roomKey: startRoomKey as RoomKey,

            parent: {
                type: "PostRange",
                contentVersion: postRoom.contentUpdate?.mappings.length ?? 0,
                startPos,
                endPos,
            },
        };
    }

    const messages = getMessagesByRoomKey(startRoomKey);
    if (messages === null) return null;

    const startMessage = messages.getLoadedMessageIfExists(startIndex);
    const endMessage = messages.getLoadedMessageIfExists(endIndex);

    if (startMessage?.payload.type !== "Content") return null;
    if (endMessage?.payload.type !== "Content") return null;

    const authorId = startMessage.author.id;
    let previousMessage = startMessage;

    for (let index = startIndex + 1; index <= endIndex; index++) {
        const message =
            index === endIndex
                ? endMessage
                : assertExists(messages.getLoadedMessageIfExists(index));

        if (message.payload.type !== "Content") {
            previousMessage = message;
            continue;
        }

        // There's a parent message in our selected message range which breaks apart
        // adjacent messages.
        if (message.payload.parent !== null) return null;

        // The messages in the range are from different authors. Can't reply to this range.
        if (message.author.id !== authorId) return null;

        // If the messages aren't adjacent then don't allow replying to this range.
        if (!shouldMergeMessages(previousMessage, message)) return null;

        previousMessage = message;
    }

    const startPos = assertExists(
        getContentViewPosFromDom(
            state.startContentElement,
            state.startNode,
            state.startOffset,
        )?.[0],
    );

    const endPos = assertExists(
        getContentViewPosFromDom(state.endContentElement, state.endNode, state.endOffset)?.[1],
    );

    return {
        ...state,

        // Safe to consider this a `RoomKey` since `getMessagesByRoomKey()` returned a
        // non-null `MessageList` for this value.
        roomKey: startRoomKey as RoomKey,

        parent: {
            type: "MessagesRange",
            startIndex,
            startContentVersion: startMessage.payload.contentUpdate?.mappings.length ?? 0,
            startPos,
            endIndex,
            endContentVersion: endMessage.payload.contentUpdate?.mappings.length ?? 0,
            endPos,
        },
    };
}
