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
import {toggleMark, wrapIn} from "prosemirror-commands";
import {Attrs, NodeType} from "prosemirror-model";
import {Command, EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState} from "react";
import {mergeProps, useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {sprinkles} from "~/client/design/sprinkles.css";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing-constants";
import {Tooltip} from "~/client/design/tooltip";
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
    // milliseconds and `showState.pos` will be the last selection position.
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
            viewRef={viewRef}
            pos={showState.pos}
            shouldAnimateOut={!shouldShow}
        />
    );
}

function ContentEditorSelectionToolbarOverlay({
    viewRef,
    pos,
    shouldAnimateOut,
}: {
    viewRef: RefObject<EditorView | null>;
    pos: number;
    shouldAnimateOut: boolean;
}) {
    const overlayRef = useRef<OverlayRef>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        let isCancelled = false;

        const run = () => {
            if (isCancelled) return;

            assert(viewRef.current);
            assert(overlayRef.current);
            assert(toolbarRef.current);

            const coords = viewRef.current.coordsAtPos(pos);

            toolbarRef.current.style.top = `${coords.top}px`;
            toolbarRef.current.style.height = `${coords.bottom - coords.top}px`;
            toolbarRef.current.style.left = `${coords.left}px`;

            overlayRef.current.forceUpdateOverlay();
        };

        // In React, child component effects run before parent component effects. So
        // `viewRef` is assigned after our effect runs. By scheduling a microtask we
        // wait until our parent's effect runs.
        scheduleMicrotask(run);

        return () => {
            isCancelled = true;
        };
    }, [pos, viewRef]);

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
                        <ContentEditorSelectionToolbar viewRef={viewRef} />
                    </Box>
                </Box>
            }
        >
            <Box ref={toolbarRef} width="0" position="absolute" pointerEvents="none" />
        </Overlay>
    );
}

function ContentEditorSelectionToolbar({viewRef}: {viewRef: RefObject<EditorView | null>}) {
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
                command={toggleMark(ContentSchema.marks.bold)}
            >
                <TextBolder />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Italicize"
                keyboardShortcut={isMac ? "⌘+I" : "Ctrl+I"}
                viewRef={viewRef}
                command={toggleMark(ContentSchema.marks.italic)}
            >
                <TextItalic />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Strikethrough"
                keyboardShortcut={isMac ? "⌘+Shift+X" : "Ctrl+Shift+X"}
                viewRef={viewRef}
                command={toggleMark(ContentSchema.marks.strike)}
            >
                <TextStrikethrough />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Link"
                keyboardShortcut={isMac ? "⌘+K" : "Ctrl+K"}
                viewRef={viewRef}
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
                // TODO(calebmer): Selecting multiple paragraphs should convert into multiple
                // list items.

                // TODO(calebmer): Toggle list when clicking on this icon button.
                command={wrapIn(ContentSchema.nodes.unorderedListItem)}
            >
                <ListBullets />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Numbered list"
                keyboardShortcut="1. Hello"
                viewRef={viewRef}
                // TODO(calebmer): Selecting multiple paragraphs should convert into multiple
                // list items.

                // TODO(calebmer): Toggle list when clicking on this icon button.
                command={wrapIn(ContentSchema.nodes.orderedListItem)}
            >
                <ListNumbers />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                dividerRight
                description="Check list"
                keyboardShortcut="[ ] Hello"
                viewRef={viewRef}
                // TODO(calebmer): Selecting multiple paragraphs should convert into multiple
                // list items.

                // TODO(calebmer): Toggle list when clicking on this icon button.
                command={wrapIn(ContentSchema.nodes.checkListItem)}
            >
                <ListChecks />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                dividerLeft
                description="Heading 1"
                keyboardShortcut="# Hello"
                viewRef={viewRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 1})}
            >
                <TextHOne />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Heading 2"
                keyboardShortcut="## Hello"
                viewRef={viewRef}
                command={toggleBlockType(ContentSchema.nodes.heading, {level: 2})}
            >
                <TextHTwo />
            </ContentEditorSelectionToolbarIconButton>
            <ContentEditorSelectionToolbarIconButton
                description="Heading 3"
                keyboardShortcut="### Hello"
                viewRef={viewRef}
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
    command,
    children,
}: {
    dividerLeft?: boolean;
    dividerRight?: boolean;
    description: string;
    keyboardShortcut: string;
    viewRef: RefObject<EditorView | null>;
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
        let hasBlockTypeAlready = false;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (hasBlockTypeAlready) return false;
            if (node.isTextblock && node.hasMarkup(nodeType, attrs)) hasBlockTypeAlready = true;
        });

        if (dispatch) {
            if (hasBlockTypeAlready) {
                dispatch(
                    state.tr
                        .setBlockType(
                            state.selection.from,
                            state.selection.to,
                            ContentSchema.nodes.paragraph,
                        )
                        .scrollIntoView(),
                );
            } else {
                dispatch(
                    state.tr
                        .setBlockType(state.selection.from, state.selection.to, nodeType, attrs)
                        .scrollIntoView(),
                );
            }
        }
        return true;
    };
}
