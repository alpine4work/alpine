import {useHover, useInteractionModality} from "@react-aria/interactions";
import {
    IconContext,
    Link,
    ListBullets,
    ListChecks,
    ListNumbers,
    Palette,
    TextBolder,
    TextHOne,
    TextHThree,
    TextHTwo,
    TextItalic,
    TextStrikethrough,
} from "phosphor-react";
import {toggleMark} from "prosemirror-commands";
import {Attrs, NodeType} from "prosemirror-model";
import {Command, EditorState, Transaction} from "prosemirror-state";
import {findWrapping} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useCallback, useEffect, useRef, useState} from "react";
import {FocusScope, mergeProps, useButton} from "react-aria";
import {ContentEditorCursorTracker} from "~/client/content/content-editor-cursor-tracker";
import {ContentEditorHighlightSelector} from "~/client/content/content-editor-highlight-selector";
import {ContentEditorSelectionLinkInput} from "~/client/content/content-editor-link-input";
import {Box} from "~/client/design/box";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {useOutsidePress} from "~/client/design/helpers/use-outside-press";
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay-animated";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeAnimationDurationMs,
} from "~/client/design/overlay-animated.css";
import {sprinkles} from "~/client/design/sprinkles.css";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing-constants";
import {Tooltip, TooltipRef} from "~/client/design/tooltip";
import {useConstant} from "~/client/helpers/lifecycle/use-constant";
import {isMac} from "~/client/helpers/platform/is-mac";
import {ContentSchema} from "~/shared/content/content-schema";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

// TODO(calebmer): Show a style as activated if it is applied. (e.g. Bold,
// italic, etc.)

export function ContentEditorPointerToolbar({
    state,
    viewRef,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
}) {
    const interactionModality = useInteractionModality();

    const shouldShow =
        // The toolbar overlay is intended for pointer use only. You can use keyboard
        // shortcuts to accomplish everything in the toolbar.
        interactionModality === "pointer" &&
        // Make sure some characters are selected before showing the selection toolbar.
        state.selection.from !== state.selection.to;

    const initialSelection = useConstant(() => state.selection);
    const [hasSelectionChangedSinceMount, setHasSelectionChangedSinceMount] = useState(false);

    useEffect(() => {
        if (
            state.selection.from !== initialSelection.from ||
            state.selection.to !== initialSelection.to
        ) {
            setHasSelectionChangedSinceMount(true);
        }
    }, [initialSelection.from, initialSelection.to, state.selection.from, state.selection.to]);

    // Once we should no longer show the toolbar, we still show it for a couple
    // milliseconds as it animates away.
    //
    // When `shouldShow` is false, `showState.isShowing` will be true for a couple
    // milliseconds and `showState.selectionPos` will be the last selection position.
    //
    // NOTE(calebmer): This component was written before `<OverlayAnimated>`. It
    // has a bit of delay before the animation begins so it isn't quite feature
    // compatible but consider consolidating someday.
    const [showState, setShowState] = useState<
        {isShowing: true; pos: number; isLinkInputOpen: boolean} | {isShowing: false}
    >({isShowing: false});

    // Update our show state whenever the selection changes while the toolbar
    // is open.
    if (shouldShow && showState.isShowing && showState.pos !== state.selection.from) {
        setShowState(prevState =>
            prevState.isShowing
                ? {
                      ...prevState,
                      pos: state.selection.from,
                      // Close the link input when the selection changes.
                      isLinkInputOpen: false,
                  }
                : prevState,
        );
    }

    useEffect(() => {
        if (
            shouldShow &&
            !showState.isShowing &&
            // Don't show the toolbar until the user has interacted with the editor.
            //
            // This defends against the case where we had a highlight toolbar opened but
            // then the user closed it and the regular toolbar wants to immediately open.
            hasSelectionChangedSinceMount
        ) {
            const timeoutId = setTimeout(() => {
                setShowState({
                    isShowing: true,
                    pos: state.selection.from,
                    isLinkInputOpen: false,
                });
            }, overlayFadeAnimationDurationMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [hasSelectionChangedSinceMount, shouldShow, showState.isShowing, state.selection.from]);

    const isFadingOut =
        !shouldShow &&
        showState.isShowing &&
        // If the link input is open then our interaction modality switches to
        // keyboard. Don't close the toolbar when this happens.
        !showState.isLinkInputOpen;

    // Keep the toolbar mounted for a bit before unmounting. This way if the user
    // is quickly clicking around they don't have to wait again for the delay that
    // shows the toolbar.
    useEffect(() => {
        if (isFadingOut) {
            const timeoutId = setTimeout(() => {
                setShowState({isShowing: false});
            }, uninterruptedThoughtLimitMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [showState, shouldShow, isFadingOut]);

    if (!showState.isShowing) return null;

    return (
        <ContentEditorPointerToolbarOverlay
            state={state}
            viewRef={viewRef}
            pos={showState.pos}
            isFadingOut={isFadingOut}
            isLinkInputOpen={showState.isLinkInputOpen}
            onLinkInputOpen={() =>
                setShowState(prevState =>
                    prevState.isShowing ? {...prevState, isLinkInputOpen: true} : prevState,
                )
            }
            onLinkInputClose={() =>
                setShowState(prevState =>
                    prevState.isShowing ? {...prevState, isLinkInputOpen: false} : prevState,
                )
            }
        />
    );
}

function ContentEditorPointerToolbarOverlay({
    state,
    viewRef,
    pos,
    isFadingOut,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    pos: number;
    isFadingOut: boolean;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);
    const tooltipRefs = useRef<Set<TooltipRef>>(new Set());

    const sharedTooltipLifecycleRef = useCallback((tooltipRef: TooltipRef) => {
        tooltipRefs.current.add(tooltipRef);
        return () => tooltipRefs.current.delete(tooltipRef);
    }, []);

    return (
        <Overlay
            ref={overlayRef}
            visible={true}
            placement="top-start"
            // Since we position the overlay based on the start of the selection we can't
            // flip down or else we might cover selection content.
            canFlip={false}
            offset="3"
            offsetAlong="-5"
            overlay={
                <div className={overlayAnimateContainerClassName}>
                    <Box
                        display="flex"
                        paddingX="1"
                        borderRadius="base"
                        backgroundColor={{light: "grey-0", dark: "grey-5"}}
                        boxShadow="elevation-20"
                        className={
                            isFadingOut
                                ? overlayAnimateFadeOutClassName
                                : overlayAnimateFadeInClassName
                        }
                    >
                        <ContentEditorPointerToolbarButtons
                            viewRef={viewRef}
                            sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                            isFadingOut={isFadingOut}
                            isLinkInputOpen={isLinkInputOpen}
                            onLinkInputOpen={onLinkInputOpen}
                            onLinkInputClose={onLinkInputClose}
                        />
                    </Box>
                </div>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={pos}
                // TODO(calebmer): Is there a better way to keep overlay positions
                // automatically up to date?
                onUpdatePosition={() => {
                    overlayRef.current?.forceUpdateOverlayPosition();

                    // Update the tooltip position with the overlay position in case there is an
                    // open tooltip.
                    for (const tooltipRef of tooltipRefs.current) {
                        tooltipRef.forceUpdateTooltipPosition();
                    }
                }}
            />
        </Overlay>
    );
}

function ContentEditorPointerToolbarButtons({
    viewRef,
    sharedTooltipLifecycleRef,
    isFadingOut,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
}: {
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isFadingOut: boolean;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
}) {
    return (
        <>
            <ContentEditorPointerToolbarButton
                description="Bold"
                keyboardShortcut={isMac ? "⌘+B" : "Ctrl+B"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleMark(ContentSchema.marks.bold)}
            >
                <TextBolder />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Italicize"
                keyboardShortcut={isMac ? "⌘+I" : "Ctrl+I"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleMark(ContentSchema.marks.italic)}
            >
                <TextItalic />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Strikethrough"
                keyboardShortcut={isMac ? "⌘+Shift+X" : "Ctrl+Shift+X"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleMark(ContentSchema.marks.strike)}
            >
                <TextStrikethrough />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarLinkButton
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isToolbarFadingOut={isFadingOut}
                isLinkInputOpen={isLinkInputOpen}
                onLinkInputOpen={onLinkInputOpen}
                onLinkInputClose={onLinkInputClose}
            />
            <ContentEditorPointerToolbarHighlightButton
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isToolbarFadingOut={isFadingOut}
            />
            <ContentEditorPointerToolbarButton
                dividerLeft
                description="Bulleted list"
                keyboardShortcut="- Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleListItems(ContentSchema.nodes.unorderedListItem)}
            >
                <ListBullets />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Numbered list"
                keyboardShortcut="1. Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleListItems(ContentSchema.nodes.orderedListItem)}
            >
                <ListNumbers />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                dividerRight
                description="Check list"
                keyboardShortcut="[ ] Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleListItems(ContentSchema.nodes.checkListItem)}
            >
                <ListChecks />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                dividerLeft
                description="Heading 1"
                keyboardShortcut="# Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 1})}
            >
                <TextHOne />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Heading 2"
                keyboardShortcut="## Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 2})}
            >
                <TextHTwo />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Heading 3"
                keyboardShortcut="### Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 3})}
            >
                <TextHThree />
            </ContentEditorPointerToolbarButton>
        </>
    );
}

function ContentEditorPointerToolbarButton({
    description,
    keyboardShortcut,
    viewRef,
    sharedTooltipLifecycleRef,
    command,
    children,
    dividerLeft,
    dividerRight,
    hasOpenOverlay,
}: {
    description: string;
    keyboardShortcut: string;
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    command: Command;
    children: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    hasOpenOverlay?: boolean;
}) {
    const onPress = () => {
        const view = viewRef.current;
        assert(view);
        command(view.state, view.dispatch, view);
    };

    const localRef = useRef<HTMLDivElement>(null);

    const {buttonProps, isPressed} = useButton(
        {
            elementType: "div",
            "aria-label": description,
            onPress,
        },
        localRef,
    );

    const {hoverProps, isHovered} = useHover({});

    return (
        <Tooltip
            ref={useLifecycleRef(sharedTooltipLifecycleRef)}
            disabled={hasOpenOverlay}
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            canFlip={false}
            content={
                <Box>
                    {description}
                    <Box color="grey-60" style={{marginTop: "-0.125rem"}}>
                        {keyboardShortcut}
                    </Box>
                </Box>
            }
        >
            <div
                {...mergeProps(buttonProps, hoverProps)}
                ref={localRef}
                // Disable the ability to focus this icon button! The icon buttons in the
                // selection toolbar are only mouse accessible. They are not keyboard
                // accessible. By being focusable then the button steals focus when you click
                // on it, so instead make the button not focusable. This also makes it so the
                // button is not reachable in tab order.
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
                    // right over our toolbar the tooltips immediately disappear/reappear because
                    // there is no gap in between the hovered elements.
                    paddingRight={dividerRight ? "1" : undefined}
                    borderRight={dividerRight ? {light: "grey-10", dark: "grey-20"} : undefined}
                    paddingLeft={dividerLeft ? "1" : undefined}
                >
                    <Box
                        padding="1"
                        borderRadius="base"
                        color={isPressed || hasOpenOverlay ? "grey-100" : "grey-80"}
                        backgroundColor={
                            isPressed || hasOpenOverlay
                                ? {light: "grey-10", dark: "grey-20"}
                                : isHovered
                                ? {light: "grey-5", dark: "grey-10"}
                                : undefined
                        }
                    >
                        <IconContext.Provider
                            value={{
                                color: "currentColor",
                                size: spacing["4"],
                            }}
                        >
                            {children}
                        </IconContext.Provider>
                    </Box>
                </Box>
            </div>
        </Tooltip>
    );
}

function ContentEditorPointerToolbarLinkButton({
    viewRef,
    sharedTooltipLifecycleRef,
    isToolbarFadingOut,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
}: {
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isToolbarFadingOut: boolean;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
}) {
    const wasJustClosedByOverlayRef = useRef(false);

    return (
        <OverlayAnimated
            visible={isLinkInputOpen && !isToolbarFadingOut}
            placement="top"
            canFlip={false}
            offset="1.5"
            overlay={
                <Box
                    ref={useOutsidePress(() => {
                        onLinkInputClose();
                        wasJustClosedByOverlayRef.current = true;
                        setTimeout(() => {
                            wasJustClosedByOverlayRef.current = false;
                        }, 0);
                    })}
                >
                    {!isLinkInputOpen ? (
                        <ContentEditorSelectionLinkInput
                            viewRef={viewRef}
                            isDisabled={true}
                            onClose={onLinkInputClose}
                        />
                    ) : (
                        <FocusScope contain restoreFocus autoFocus>
                            <ContentEditorSelectionLinkInput
                                viewRef={viewRef}
                                onClose={onLinkInputClose}
                            />
                        </FocusScope>
                    )}
                </Box>
            }
        >
            <Box>
                <ContentEditorPointerToolbarButton
                    description="Link"
                    keyboardShortcut={isMac ? "⌘+K" : "Ctrl+K"}
                    hasOpenOverlay={isLinkInputOpen}
                    viewRef={viewRef}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    command={() => {
                        // If the user clicks on this button to close the highlight color overlay then
                        // this `command` will run after the `useOutsidePress()` above which closes the
                        // overlay. We want the overlay to stay closed so we need to coordinate with
                        // a ref.
                        if (!wasJustClosedByOverlayRef.current) {
                            if (isLinkInputOpen) {
                                onLinkInputClose();
                            } else {
                                onLinkInputOpen();
                            }
                        }
                        return false;
                    }}
                >
                    <Link />
                </ContentEditorPointerToolbarButton>
            </Box>
        </OverlayAnimated>
    );
}

function ContentEditorPointerToolbarHighlightButton({
    viewRef,
    sharedTooltipLifecycleRef,
    isToolbarFadingOut,
}: {
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isToolbarFadingOut: boolean;
}) {
    const [_isOpen, setIsOpen] = useState(false);
    const isOpen = _isOpen && !isToolbarFadingOut;
    if (_isOpen !== isOpen) setIsOpen(isOpen);

    const wasJustClosedByOverlayRef = useRef(false);

    return (
        <OverlayAnimated
            visible={isOpen}
            placement="top"
            canFlip={false}
            offset="1.5"
            overlay={
                <Box
                    ref={useOutsidePress(() => {
                        setIsOpen(false);
                        wasJustClosedByOverlayRef.current = true;
                        setTimeout(() => {
                            wasJustClosedByOverlayRef.current = false;
                        }, 0);
                    })}
                >
                    <ContentEditorHighlightSelector
                        viewRef={viewRef}
                        isFocusable={false}
                        onClose={() => setIsOpen(false)}
                    />
                </Box>
            }
        >
            <Box>
                <ContentEditorPointerToolbarButton
                    dividerRight
                    description="Highlight"
                    keyboardShortcut={isMac ? "⌘+Shift+H" : "Ctrl+Shift+H"}
                    hasOpenOverlay={isOpen}
                    viewRef={viewRef}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    command={() => {
                        // If the user clicks on this button to close the highlight color overlay then
                        // this `command` will run after the `useOutsidePress()` above which closes the
                        // overlay. We want the overlay to stay closed so we need to coordinate with
                        // a ref.
                        if (!wasJustClosedByOverlayRef.current) {
                            setIsOpen(!isOpen);
                        }
                        return false;
                    }}
                >
                    <Palette />
                </ContentEditorPointerToolbarButton>
            </Box>
        </OverlayAnimated>
    );
}

function toggleBlockType(nodeType: NodeType, attrs: Attrs | null = null): Command {
    return (state, dispatch) => {
        let canAnyNodeBecomeBlockType = false;
        let isEveryNodeAlreadyBlockType: boolean | undefined;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            // If we have found one node that can become our block type we don't need to
            // keep iterating.
            if (canAnyNodeBecomeBlockType) return false;

            // Ignore nodes that aren't text blocks.
            if (!node.isTextblock) return;

            if (node.hasMarkup(nodeType, attrs)) {
                if (isEveryNodeAlreadyBlockType === undefined) isEveryNodeAlreadyBlockType = true;
                return;
            }

            // If we see one node that doesn't match the block type, set to false.
            isEveryNodeAlreadyBlockType = false;

            if (node.type === nodeType) {
                canAnyNodeBecomeBlockType = true;
            } else {
                const $pos = state.doc.resolve(pos);
                const index = $pos.index();
                if ($pos.parent.canReplaceWith(index, index + 1, nodeType)) {
                    canAnyNodeBecomeBlockType = true;
                }
            }
        });

        // If there were no nodes then this variable is false.
        if (isEveryNodeAlreadyBlockType === undefined) isEveryNodeAlreadyBlockType = false;

        if (isEveryNodeAlreadyBlockType) {
            dispatch?.(
                state.tr
                    .setBlockType(
                        state.selection.from,
                        state.selection.to,
                        ContentSchema.nodes.paragraph,
                    )
                    .scrollIntoView(),
            );
            return true;
        }

        if (canAnyNodeBecomeBlockType) {
            dispatch?.(
                state.tr
                    .setBlockType(state.selection.from, state.selection.to, nodeType, attrs)
                    .scrollIntoView(),
            );
            return true;
        }

        return false;
    };
}

function toggleListItems(nodeType: NodeType): Command {
    assert(nodeType.groups.includes("listItem"));

    return (state, dispatch) => {
        const toggleOnTransforms: Array<(transaction: Transaction) => Transaction> = [];
        const toggleOffTransforms: Array<(transaction: Transaction) => Transaction> = [];

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            const $pos = state.doc.resolve(pos);
            const range = $pos.blockRange(state.doc.resolve(pos + node.nodeSize));

            if (range) {
                // If this node is already the list item node type, we want to remove the
                // list item style if all other nodes are also of the list item type.
                if (node.type === nodeType) {
                    const $contentPos = state.doc.resolve(pos + 1);
                    const contentRange = $contentPos.blockRange(
                        state.doc.resolve(pos + node.nodeSize - 1),
                    );
                    assert(contentRange);
                    toggleOffTransforms.push(tr => tr.lift(contentRange, $contentPos.depth - 1));
                }
                // If the node is another list item node type then we want to keep the node as
                // a list item but switch it to our list item node type.
                else if (node.type.groups.includes("listItem")) {
                    toggleOnTransforms.push(tr =>
                        tr.setNodeMarkup(pos, nodeType, {indent: node.attrs.indent}),
                    );
                }
                // If the node is a text block (paragraph probably) then wrap it in a list item
                // if possible.
                else if (node.isTextblock) {
                    const wrapping = findWrapping(range, nodeType);
                    if (wrapping) {
                        toggleOnTransforms.push(tr => tr.wrap(range, wrapping));
                    }
                }
            }
        });

        if (toggleOnTransforms.length === 0 && toggleOffTransforms.length === 0) {
            return false;
        }

        dispatch?.(
            // If there are some non-list nodes that can be toggled on then we're toggling
            // on. Otherwise toggle off by lifting list items.
            (toggleOnTransforms.length > 0 ? toggleOnTransforms : toggleOffTransforms)
                // We `reduceRight()` and apply our transforms in reverse because they affect
                // the doc in ascending `pos` order. So each transform may adjust the positions
                // in the doc after the content it changes. By applying in reverse order each
                // transform won't affect the next transforms position.
                .reduceRight((tr, transform) => transform(tr), state.tr)
                .scrollIntoView(),
        );
        return true;
    };
}
