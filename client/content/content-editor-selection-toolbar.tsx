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
import {
    ReactNode,
    RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {mergeProps, useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {sprinkles} from "~/client/design/sprinkles.css";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing-constants";
import {Tooltip, TooltipRef} from "~/client/design/tooltip";
import {
    tooltipAnimateContainerClassName,
    tooltipAnimateFadeInClassName,
    tooltipAnimateFadeOutClassName,
} from "~/client/design/tooltip.css";
import {isMac} from "~/client/helpers/platform/is-mac";
import {ContentSchema} from "~/shared/content/content-schema";
import {spacing} from "~/shared/design/spacing";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";

export function ContentEditorSelectionToolbarManager({
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

    // Once we should no longer show the toolbar, we still show it for a couple
    // milliseconds as it animates away.
    //
    // When `shouldShow` is false, `showState.isShowing` will be true for a couple
    // milliseconds and `showState.selectionPos` will be the last selection position.
    const [showState, setShowState] = useState<{isShowing: true; pos: number} | {isShowing: false}>(
        shouldShow ? {isShowing: true, pos: state.selection.from} : {isShowing: false},
    );

    if (shouldShow && showState.isShowing && showState.pos !== state.selection.from) {
        setShowState({isShowing: true, pos: state.selection.from});
    }

    useEffect(() => {
        if (shouldShow && !showState.isShowing) {
            const timeoutId = setTimeout(() => {
                setShowState({isShowing: true, pos: state.selection.from});
            }, uninterruptedThoughtLimitMs / 2);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [shouldShow, showState.isShowing, state.selection.from]);

    useEffect(() => {
        if (!shouldShow && showState.isShowing) {
            const timeoutId = setTimeout(() => {
                setShowState({isShowing: false});
            }, uninterruptedThoughtLimitMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [showState, shouldShow]);

    if (!showState.isShowing) return null;

    return (
        <ContentEditorSelectionToolbarOverlay
            state={state}
            viewRef={viewRef}
            pos={showState.pos}
            shouldAnimateOut={!shouldShow}
        />
    );
}

function ContentEditorSelectionToolbarOverlay({
    state,
    viewRef,
    pos,
    shouldAnimateOut,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    pos: number;
    shouldAnimateOut: boolean;
}) {
    const overlayRef = useRef<OverlayRef>(null);
    const targetRef = useRef<HTMLDivElement>(null);

    const tooltipRefs = useRef<Set<TooltipRef>>(new Set());

    const sharedTooltipLifecycleRef = useCallback((tooltipRef: TooltipRef) => {
        tooltipRefs.current.add(tooltipRef);
        return () => tooltipRefs.current.delete(tooltipRef);
    }, []);

    useLayoutEffect(() => {
        let isCancelled = false;

        // We want this effect to run whenever the underlying doc changes too.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state.doc;

        const run = () => {
            if (isCancelled) return;

            assert(viewRef.current);
            assert(overlayRef.current);
            assert(targetRef.current);

            // jsdom doesn't care about layout so this property doesn't exist.
            if (typeof jest !== "undefined" && !targetRef.current.offsetParent) return;
            assert(targetRef.current.offsetParent);

            // `coords` are relative to the viewport, so get our offset parent's viewport
            // rect so we can correctly position our selection target in the offset parent.
            const coords = viewRef.current.coordsAtPos(pos);
            const offsetParentRect = targetRef.current.offsetParent.getBoundingClientRect();

            targetRef.current.style.top = `${coords.top - offsetParentRect.top}px`;
            targetRef.current.style.height = `${coords.bottom - coords.top}px`;
            targetRef.current.style.left = `${coords.left - offsetParentRect.left}px`;

            overlayRef.current.forceUpdateOverlayPosition();

            // Update the tooltip position with the overlay position in case there is an
            // open tooltip.
            for (const tooltipRef of tooltipRefs.current) {
                tooltipRef.forceUpdateTooltipPosition();
            }
        };

        // In React, child component effects run before parent component effects. So
        // `viewRef` is assigned after our effect runs. By scheduling a microtask we
        // wait until our parent's effect runs.
        scheduleMicrotask(run);

        return () => {
            isCancelled = true;
        };
    }, [pos, state.doc, viewRef]);

    return (
        <Overlay
            ref={overlayRef}
            visible={true}
            placement="top-start"
            offsetAway="3"
            offsetAlong="-5"
            flip={false}
            overlay={
                <Box className={tooltipAnimateContainerClassName}>
                    <Box
                        className={
                            shouldAnimateOut
                                ? tooltipAnimateFadeOutClassName
                                : tooltipAnimateFadeInClassName
                        }
                    >
                        <ContentEditorSelectionToolbar
                            viewRef={viewRef}
                            sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        />
                    </Box>
                </Box>
            }
        >
            <Box ref={targetRef} width="0" position="absolute" pointerEvents="none" />
        </Overlay>
    );
}

function ContentEditorSelectionToolbar({
    viewRef,
    sharedTooltipLifecycleRef,
}: {
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
}) {
    return (
        <Box
            display="flex"
            paddingX="1"
            borderRadius="base"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            boxShadow="elevation-20"
        >
            <ContentEditorSelectionToolbarIconButton
                description="Bold"
                keyboardShortcut={isMac ? "⌘+B" : "Ctrl+B"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleMark(ContentSchema.marks.bold)}
            >
                <TextBolder />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Italicize"
                keyboardShortcut={isMac ? "⌘+I" : "Ctrl+I"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleMark(ContentSchema.marks.italic)}
            >
                <TextItalic />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Strikethrough"
                keyboardShortcut={isMac ? "⌘+Shift+X" : "Ctrl+Shift+X"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleMark(ContentSchema.marks.strike)}
            >
                <TextStrikethrough />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Link"
                keyboardShortcut={isMac ? "⌘+K" : "Ctrl+K"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={() => {
                    // TODO(calebmer): Implement
                    return false;
                }}
            >
                <Link />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                dividerRight
                description="Highlight"
                // TODO(calebmer): Actually implement highlight keyboard shortcut
                keyboardShortcut={isMac ? "⌘+Shift+H" : "Ctrl+Shift+H"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={() => {
                    // TODO(calebmer): Implement
                    return false;
                }}
            >
                <Palette />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                dividerLeft
                description="Bulleted list"
                keyboardShortcut="- Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleListItems(ContentSchema.nodes.unorderedListItem)}
            >
                <ListBullets />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Numbered list"
                keyboardShortcut="1. Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleListItems(ContentSchema.nodes.orderedListItem)}
            >
                <ListNumbers />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                dividerRight
                description="Check list"
                keyboardShortcut="[ ] Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleListItems(ContentSchema.nodes.checkListItem)}
            >
                <ListChecks />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                dividerLeft
                description="Heading 1"
                keyboardShortcut="# Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 1})}
            >
                <TextHOne />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Heading 2"
                keyboardShortcut="## Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 2})}
            >
                <TextHTwo />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Heading 3"
                keyboardShortcut="### Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 3})}
            >
                <TextHThree />
            </ContentEditorSelectionToolbarIconButton>
        </Box>
    );
}

function ContentEditorSelectionToolbarIconButton({
    dividerLeft,
    dividerRight,
    description,
    keyboardShortcut,
    viewRef,
    sharedTooltipLifecycleRef,
    command,
    children,
}: {
    dividerLeft?: boolean;
    dividerRight?: boolean;
    description: string;
    keyboardShortcut: string;
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    command: Command;
    children: ReactNode;
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
            placement="top"
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
                <div
                    className={sprinkles({
                        // We implement dividers in this funky way so that as the mouse scrubs left and
                        // right over our toolbar the tooltips immediately disappear/reappear because
                        // there is no gap in between the hovered elements.
                        paddingRight: dividerRight ? "1" : undefined,
                        borderRight: dividerRight ? {light: "grey-10", dark: "grey-20"} : undefined,
                        paddingLeft: dividerLeft ? "1" : undefined,
                    })}
                >
                    <div
                        className={sprinkles({
                            padding: "1",
                            borderRadius: "base",
                            color: isPressed ? "grey-100" : "grey-80",
                            backgroundColor: {
                                light: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                                dark: isPressed ? "grey-20" : isHovered ? "grey-10" : undefined,
                            },
                        })}
                    >
                        <IconContext.Provider
                            value={{
                                color: "currentColor",
                                size: spacing["4"],
                            }}
                        >
                            {children}
                        </IconContext.Provider>
                    </div>
                </div>
            </div>
        </Tooltip>
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
