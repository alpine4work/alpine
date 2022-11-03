import {useHover, useInteractionModality} from "@react-aria/interactions";
import {
    IconContext,
    Link as LinkIcon,
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
import {Mark} from "prosemirror-model";
import {Command, EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {FocusScope, mergeProps, useButton} from "react-aria";
import {ContentEditorCursorTracker} from "~/client/content/internal/content-editor-cursor-tracker";
import {ContentEditorHighlightSelector} from "~/client/content/internal/content-editor-highlight-selector";
import {ContentEditorLinkInput} from "~/client/content/internal/content-editor-link-input";
import {
    areAllNodesBlockType,
    areAllNodesListItemType,
    createToggleBlockTypeCommand,
    createToggleListItemsCommand,
    createToggleMarkCommand,
    getMarksSpanningAcrossEntireRange,
    trimSpacesFromRange,
} from "~/client/content/internal/content-editor-prosemirror-helpers";
import {Box} from "~/client/design/box";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {useOutsidePress} from "~/client/design/helpers/use-outside-press";
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay-animated";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing-constants";
import {Tooltip, TooltipRef} from "~/client/design/tooltip";
import {useConstant} from "~/client/helpers/lifecycle/use-constant";
import {isMac} from "~/client/helpers/platform/is-mac";
import {ContentProsemirrorSchema} from "~/shared/content/content-schema";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeAnimationDurationMs,
    sprinkles,
} from "~/shared/styles/styles";

export function ContentEditorPointerToolbar({
    state,
    viewRef,
    isFocused,
    lastSelectionChangeTransactionTime,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    isFocused: boolean;
    lastSelectionChangeTransactionTime: number | null;
}) {
    const interactionModality = useInteractionModality();

    const shouldShow =
        isFocused &&
        // The toolbar overlay is intended for pointer use only. You can use keyboard
        // shortcuts to accomplish everything in the toolbar.
        interactionModality === "pointer" &&
        // Make sure some characters are selected before showing the selection toolbar.
        state.selection.from !== state.selection.to &&
        // Don't show the toolbar if the selection overlaps with the title. The title
        // can only be at the beginning of a document so checking whether
        // `selection.from` is in the title is sufficient for detecting overlap.
        state.selection.$from.parent.type.name !== "title";

    const initialSelection = useConstant(() => state.selection);

    const [hasSelectionChangedSinceMount, setHasSelectionChangedSinceMount] = useState(() => {
        // If the selection changed right before our component mounted then treat it as
        // if the selection changed after our component mounted.
        //
        // Specifically, if the selection changed but we were waiting on an
        // `<OverlayAnimated>` animation to finish, we want our toolbar to open.
        //
        // For example, say you hover over a link. When you double click on a word to
        // select it then after the link's floater closes (because it uses
        // `useOutsidePress(onClose)`) we want the toolbar to open.
        if (
            lastSelectionChangeTransactionTime !== null &&
            lastSelectionChangeTransactionTime > Date.now() - overlayFadeAnimationDurationMs * 2
        ) {
            return true;
        }

        return false;
    });

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
        | {
              isShowing: true;
              pos: number;
              animation: "FadingIn" | "FadingOut" | null;
              isLinkInputOpen: boolean;
          }
        | {isShowing: false; animation?: undefined}
    >({isShowing: false});

    // Update our show state whenever the selection changes while the toolbar
    // is open.
    if (shouldShow && showState.isShowing && showState.pos !== state.selection.from) {
        setShowState(prevState =>
            prevState.isShowing
                ? {
                      ...prevState,
                      pos: state.selection.from,
                      animation:
                          prevState.animation === "FadingOut" ? "FadingIn" : prevState.animation,
                      // Close the link input when the selection changes.
                      isLinkInputOpen: false,
                  }
                : prevState,
        );
    }

    // If we should stop showing then start the fade out animation.
    if (
        !shouldShow &&
        showState.isShowing &&
        !showState.animation &&
        // If the link input is open then our interaction modality switches to
        // keyboard. Don't close the toolbar when this happens.
        !showState.isLinkInputOpen
    ) {
        setShowState({...showState, animation: "FadingOut"});
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
                    animation: "FadingIn",
                    isLinkInputOpen: false,
                });
            }, overlayFadeAnimationDurationMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [hasSelectionChangedSinceMount, shouldShow, showState.isShowing, state.selection.from]);

    useEffect(() => {
        if (showState.isShowing && showState.animation === "FadingIn") {
            const timeoutId = setTimeout(() => {
                setShowState(showState =>
                    showState.isShowing ? {...showState, animation: null} : showState,
                );
            }, overlayFadeAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [showState.animation, showState.isShowing]);

    // Keep the toolbar mounted for a bit before unmounting. This way if the user
    // is quickly clicking around they don't have to wait again for the delay that
    // shows the toolbar.
    useEffect(() => {
        if (showState.isShowing && showState.animation === "FadingOut") {
            const timeoutId = setTimeout(() => {
                setShowState({isShowing: false});
            }, uninterruptedThoughtLimitMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [showState.isShowing, showState.animation]);

    if (!showState.isShowing) return null;

    return (
        <ContentEditorPointerToolbarOverlay
            state={state}
            viewRef={viewRef}
            pos={showState.pos}
            animation={showState.animation}
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
    animation,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    pos: number;
    animation: "FadingIn" | "FadingOut" | null;
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
                        paddingLeft="1"
                        paddingRight="0.5"
                        borderRadius="base"
                        backgroundColor={{light: "grey-0", dark: "grey-5"}}
                        boxShadow="elevation-20"
                        className={
                            animation === "FadingIn"
                                ? overlayAnimateFadeInClassName
                                : animation === "FadingOut"
                                ? overlayAnimateFadeOutClassName
                                : undefined
                        }
                        style={{marginLeft: -1, marginRight: -1}}
                    >
                        <ContentEditorPointerToolbarButtons
                            state={state}
                            viewRef={viewRef}
                            sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                            isFadingOut={animation === "FadingOut"}
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
    state,
    viewRef,
    sharedTooltipLifecycleRef,
    isFadingOut,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isFadingOut: boolean;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
}) {
    const {isBold, isItalic, isStrike, activeLinkMark, activeHighlightMark} = useMemo(() => {
        const marks = getMarksSpanningAcrossEntireRange(state.doc, state.selection);

        const activeLinkMark = marks.find(mark => mark.type.name === "link") ?? null;
        const activeHighlightMark = marks.find(mark => mark.type.name === "highlight") ?? null;

        return {
            isBold: state.schema.mark("bold").isInSet(marks),
            isItalic: state.schema.mark("italic").isInSet(marks),
            isStrike: state.schema.mark("strike").isInSet(marks),
            activeLinkMark,
            activeHighlightMark,
        };
    }, [state.doc, state.schema, state.selection]);

    const isCheckListActive = useMemo(
        () =>
            !!state.schema.nodes.checkListItem &&
            areAllNodesListItemType(state.doc, state.selection, state.schema.nodes.checkListItem),
        [state.doc, state.schema.nodes.checkListItem, state.selection],
    );

    const isHeadingLevel1Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, state.schema.nodes.heading, {
                level: 1,
            }),
        [state.doc, state.schema.nodes.heading, state.selection],
    );

    const isHeadingLevel2Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, state.schema.nodes.heading, {
                level: 2,
            }),
        [state.doc, state.schema.nodes.heading, state.selection],
    );

    const isHeadingLevel3Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, state.schema.nodes.heading, {
                level: 3,
            }),
        [state.doc, state.schema.nodes.heading, state.selection],
    );

    return (
        <>
            <ContentEditorPointerToolbarButton
                description="Bold"
                keyboardShortcut={isMac ? "⌘+B" : "Ctrl+B"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={isBold}
                command={createToggleMarkCommand(state.schema.mark("bold"))}
            >
                <TextBolder />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Italicize"
                keyboardShortcut={isMac ? "⌘+I" : "Ctrl+I"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={isItalic}
                command={createToggleMarkCommand(state.schema.mark("italic"))}
            >
                <TextItalic />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Strikethrough"
                keyboardShortcut={isMac ? "⌘+Shift+X" : "Ctrl+Shift+X"}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={isStrike}
                command={createToggleMarkCommand(state.schema.mark("strike"))}
            >
                <TextStrikethrough />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarLinkButton
                state={state}
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isToolbarFadingOut={isFadingOut}
                activeLinkMark={activeLinkMark}
                isLinkInputOpen={isLinkInputOpen}
                onLinkInputOpen={onLinkInputOpen}
                onLinkInputClose={onLinkInputClose}
            />
            {state.schema.marks.highlight && (
                <ContentEditorPointerToolbarHighlightButton
                    viewRef={viewRef}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    isToolbarFadingOut={isFadingOut}
                    activeHighlightMark={activeHighlightMark}
                />
            )}
            <ContentEditorPointerToolbarButton
                dividerLeft
                description="Bulleted list"
                keyboardShortcut="- Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={useMemo(
                    () =>
                        areAllNodesListItemType(
                            state.doc,
                            state.selection,
                            state.schema.nodes.unorderedListItem,
                        ),
                    [state.doc, state.schema.nodes.unorderedListItem, state.selection],
                )}
                command={createToggleListItemsCommand(state.schema.nodes.unorderedListItem)}
            >
                <ListBullets />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Numbered list"
                keyboardShortcut="1. Hello"
                viewRef={viewRef}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={useMemo(
                    () =>
                        areAllNodesListItemType(
                            state.doc,
                            state.selection,
                            state.schema.nodes.orderedListItem,
                        ),
                    [state.doc, state.schema.nodes.orderedListItem, state.selection],
                )}
                command={createToggleListItemsCommand(state.schema.nodes.orderedListItem)}
            >
                <ListNumbers />
            </ContentEditorPointerToolbarButton>
            {state.schema.nodes.checkListItem && (
                <ContentEditorPointerToolbarButton
                    dividerRight
                    description="Check list"
                    keyboardShortcut="[ ] Hello"
                    viewRef={viewRef}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    isActive={isCheckListActive}
                    command={createToggleListItemsCommand(state.schema.nodes.checkListItem)}
                >
                    <ListChecks />
                </ContentEditorPointerToolbarButton>
            )}
            {state.schema.nodes.heading && (
                <>
                    <ContentEditorPointerToolbarButton
                        dividerLeft
                        description="Heading 1"
                        keyboardShortcut="# Hello"
                        viewRef={viewRef}
                        sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        isActive={isHeadingLevel1Active}
                        command={createToggleBlockTypeCommand(state.schema.nodes.heading, {
                            level: 1,
                        })}
                    >
                        <TextHOne />
                    </ContentEditorPointerToolbarButton>
                    <ContentEditorPointerToolbarButton
                        description="Heading 2"
                        keyboardShortcut="## Hello"
                        viewRef={viewRef}
                        sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        isActive={isHeadingLevel2Active}
                        command={createToggleBlockTypeCommand(state.schema.nodes.heading, {
                            level: 2,
                        })}
                    >
                        <TextHTwo />
                    </ContentEditorPointerToolbarButton>
                    <ContentEditorPointerToolbarButton
                        description="Heading 3"
                        keyboardShortcut="### Hello"
                        viewRef={viewRef}
                        sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        isActive={isHeadingLevel3Active}
                        command={createToggleBlockTypeCommand(state.schema.nodes.heading, {
                            level: 3,
                        })}
                    >
                        <TextHThree />
                    </ContentEditorPointerToolbarButton>
                </>
            )}
        </>
    );
}

function ContentEditorPointerToolbarButton({
    description,
    keyboardShortcut,
    viewRef,
    sharedTooltipLifecycleRef,
    isActive,
    isTooltipDisabled,
    command,
    children,
    dividerLeft,
    dividerRight,
}: {
    description: string;
    keyboardShortcut: string;
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isActive: boolean;
    isTooltipDisabled?: boolean;
    command: Command;
    children: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const onPress = () => {
        const view = viewRef.current;
        assert(view);
        command(view.state, view.dispatch.bind(view), view);
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
            disabled={isTooltipDisabled}
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            canFlip={false}
            content={
                <Box paddingY="0.5">
                    {description}
                    <Box color="grey-60">{keyboardShortcut}</Box>
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
                    paddingRight={dividerRight ? "1" : "0.5"}
                    borderRight={dividerRight ? {light: "grey-10", dark: "grey-20"} : undefined}
                    paddingLeft={dividerLeft ? "1" : undefined}
                >
                    <Box
                        padding="1"
                        borderRadius="base"
                        color={isPressed || isActive ? "grey-100" : "grey-80"}
                        backgroundColor={
                            isPressed || isActive
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
    state,
    viewRef,
    sharedTooltipLifecycleRef,
    isToolbarFadingOut,
    activeLinkMark,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isToolbarFadingOut: boolean;
    activeLinkMark: Mark | null;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
}) {
    const wasJustClosedByOverlayRef = useRef(false);

    const range = useMemo(
        () => trimSpacesFromRange(state.doc, state.selection),
        [state.doc, state.selection],
    );

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
                        <ContentEditorLinkInput
                            viewRef={viewRef}
                            range={range}
                            mark={activeLinkMark}
                            isDisabled={true}
                            onClose={onLinkInputClose}
                        />
                    ) : (
                        <FocusScope contain restoreFocus autoFocus>
                            <ContentEditorLinkInput
                                viewRef={viewRef}
                                range={range}
                                mark={activeLinkMark}
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
                    isActive={isLinkInputOpen || !!activeLinkMark}
                    isTooltipDisabled={isLinkInputOpen}
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
                    <LinkIcon />
                </ContentEditorPointerToolbarButton>
            </Box>
        </OverlayAnimated>
    );
}

function ContentEditorPointerToolbarHighlightButton({
    viewRef,
    sharedTooltipLifecycleRef,
    isToolbarFadingOut,
    activeHighlightMark,
}: {
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: (tooltipRef: TooltipRef) => () => void;
    isToolbarFadingOut: boolean;
    activeHighlightMark: Mark | null;
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
                        mark={activeHighlightMark}
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
                    isActive={isOpen || !!activeHighlightMark}
                    isTooltipDisabled={isOpen}
                    viewRef={viewRef}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    command={() => {
                        assert(viewRef.current);
                        const {state} = viewRef.current;
                        const dispatch = viewRef.current.dispatch.bind(viewRef.current);

                        assert(state.schema.marks.highlight);

                        // Clicking the highlight button when there is an active highlight mark removes
                        // the highlight. Because the button is rendered in the activated style.
                        if (activeHighlightMark) {
                            dispatch(
                                state.tr.removeMark(
                                    state.selection.from,
                                    state.selection.to,
                                    state.schema.marks.highlight,
                                ),
                            );
                            return true;
                        }

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
