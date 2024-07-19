import {useHover, useInteractionModality, usePress} from "@react-aria/interactions";
import classNames from "classnames";
import {
    ChatCircleText,
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
import {Mark, Slice} from "prosemirror-model";
import {Command, EditorState, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Memo, ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {mergeProps} from "react-aria";
import {flushSync} from "react-dom";
import {openCommentInputFloaterMetaKey} from "~/client/content/internal/build_content_editor_keymap_plugin.js";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {ContentEditorHighlightSelector} from "~/client/content/internal/content_editor_highlight_selector.js";
import {ContentEditorLinkInput} from "~/client/content/internal/content_editor_link_input.js";
import {areAllNodesBlockType} from "~/client/content/internal/helpers/are_all_nodes_block_type.js";
import {areAllNodesListItemType} from "~/client/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleBlockTypeCommand} from "~/client/content/internal/helpers/create_toggle_block_type_command.js";
import {createToggleListItemsCommand} from "~/client/content/internal/helpers/create_toggle_list_items_command.js";
import {createToggleMarkCommand} from "~/client/content/internal/helpers/create_toggle_mark_command.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {Box} from "~/client/design/box.js";
import {useOutsidePress} from "~/client/design/helpers/use_outside_interaction.js";
import {Overlay, OverlayRef} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {doubleClickDelayMs} from "~/client/design/timing_constants.js";
import {Tooltip, TooltipRef, TooltipState} from "~/client/design/tooltip.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {
    greyElevated2ClassName,
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
    sprinkles,
} from "~/shared/styles/styles.js";

export function ContentEditorPointerToolbar({
    state,
    viewRef,
    isFocused,
    lastSelectionChangeTransactionTime,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    isFocused: boolean;
    lastSelectionChangeTransactionTime: number | null;
}) {
    const interactionModality = useInteractionModality();

    // If the pointer has moved while pressing down and the user has some text
    // selected, the user is probably trying to drag to change their selection. If
    // they are dragging then we don't want to show the toolbar since it won't have
    // much use. They can't click anything in the toolbar until they release
    // anyway.
    //
    // If we show the toolbar while dragging it jumps around awkwardly and blocks
    // pointer events from the mouse over content the user is potentially
    // dragging to.
    const [hasPointerMovedWhileDown, setHasPointerMovedWhileDown] = useState(false);

    const [isWaitingForTripleClickAfterDoubleClick, setIsWaitingForTripleClickAfterDoubleClick] =
        useState(false);

    useEffect(() => {
        if (!isWaitingForTripleClickAfterDoubleClick) return;

        const timeout = createTimeout(() => {
            setIsWaitingForTripleClickAfterDoubleClick(false);
        }, doubleClickDelayMs);

        return () => timeout.clear();
    }, [isWaitingForTripleClickAfterDoubleClick]);

    const shouldShowIgnoringInteractionModality = useMemo(
        () =>
            isFocused &&
            // Make sure some characters are selected before showing the selection toolbar.
            state.selection.from !== state.selection.to &&
            // Only show the pointer toolbar for a text selection. This includes the
            // `AllSelection`.
            state.selection instanceof TextSelection &&
            // If the user has only selected a newline, don't show the toolbar for an empty
            // selection. This happens when the user double-clicks near a newline in
            // Chrome. The newline is selected. On triple-click the paragraph following the
            // newline is also selected.
            //
            // Chrome doesn't render a text highlight when only a newline is selected.
            // Which means we show the toolbar above nothing which doesn't make sense. Also
            // having the toolbar jump from the right to the left when the user
            // triple-clicks after a double-click looks weird.
            //
            // Styling just a node boundary is kind of ridiculous so since it looks weird
            // to show the toolbar on a node boundary, disable the toolbar entirely on node
            // boundary selections.
            !isNodeBoundarySlice(state.doc.slice(state.selection.from, state.selection.to)) &&
            // Don't show the toolbar if the selection overlaps with the title. The title
            // can only be at the beginning of a document so checking whether
            // `selection.from` is in the title is sufficient for detecting overlap.
            state.selection.$from.parent.type.name !== "title" &&
            // Don't show the toolbar if the user's pointer is dragging to select text.
            !hasPointerMovedWhileDown &&
            // If the user has double clicked (to select a word) then we wait to see if
            // they triple click (to select a paragraph) before showing the pointer
            // toolbar. Otherwise it looks a little glitchy to see the toolbar appear then
            // immediately jump to the beginning of the paragraph.
            !isWaitingForTripleClickAfterDoubleClick,
        [
            hasPointerMovedWhileDown,
            isFocused,
            isWaitingForTripleClickAfterDoubleClick,
            state.doc,
            state.selection,
        ],
    );

    const [
        hasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow,
        setHasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow,
    ] = useState(false);

    // Quality of life: If the user selects some text with their keyboard then
    // moves their mouse then we want to show the toolbar. `react-aria` updates the
    // interaction modality on the `pointermove` event but does not trigger an
    // update for the `useInteractionModality()` hook! So if we observe a
    // `pointermove` event then we want to consider the modality changed.
    //
    // See:
    // - https://github.com/adobe/react-spectrum/blob/ec55e9512835f6d918bb14899a1f55f019f558b8/packages/%40react-aria/interactions/src/useFocusVisible.ts#L142
    // - https://github.com/adobe/react-spectrum/blob/ec55e9512835f6d918bb14899a1f55f019f558b8/packages/%40react-aria/interactions/src/useFocusVisible.ts#L74-L77
    useEffect(() => {
        if (interactionModality === "pointer" || !shouldShowIgnoringInteractionModality) {
            setHasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow(false);
            return;
        }

        // We don't need the listener anymore once this is true.
        if (hasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow) return;

        const handler = () => {
            setHasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow(true);
        };

        document.addEventListener("pointermove", handler, true);
        return () => {
            document.removeEventListener("pointermove", handler, true);
        };
    }, [
        hasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow,
        interactionModality,
        setHasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow,
        shouldShowIgnoringInteractionModality,
    ]);

    const shouldShow =
        shouldShowIgnoringInteractionModality &&
        // The toolbar overlay is intended for pointer use only. You can use keyboard
        // shortcuts to accomplish everything in the toolbar.
        (interactionModality === "pointer" ||
            hasPointerMovedDuringNonPointerInteractionModalityWhenShouldShow);

    // If `shouldShow` is true then we don't update `hasPointerMovedWhileDown`
    // and `isWaitingForTripleClickAfterDoubleClick`.
    if (shouldShow && (hasPointerMovedWhileDown || isWaitingForTripleClickAfterDoubleClick)) {
        setHasPointerMovedWhileDown(false);
        setIsWaitingForTripleClickAfterDoubleClick(false);
    }

    useEffect(() => {
        if (shouldShow) return;

        setHasPointerMovedWhileDown(false);

        let isPointerDown = false;

        let lastMouseDownTime1: number | null = null;
        let lastMouseDownTime2: number | null = null;

        const handlePointerDown = (event: PointerEvent) => {
            isPointerDown = true;

            if (event.pointerType === "mouse") {
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
            if (isPointerDown) {
                setHasPointerMovedWhileDown(true);
            }

            // If the pointer moves, triple click chances are cancelled.
            setIsWaitingForTripleClickAfterDoubleClick(false);
        };

        const handlePointerUp = () => {
            isPointerDown = false;
            setHasPointerMovedWhileDown(false);
        };

        const handlePointerCancel = () => {
            isPointerDown = false;
            setHasPointerMovedWhileDown(false);
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("pointermove", handlePointerMove, true);
        document.addEventListener("pointerup", handlePointerUp, true);
        document.addEventListener("pointercancel", handlePointerCancel, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("pointermove", handlePointerMove, true);
            document.removeEventListener("pointerup", handlePointerUp, true);
            document.removeEventListener("pointercancel", handlePointerCancel, true);
        };
    }, [shouldShow]);

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
            lastSelectionChangeTransactionTime > Date.now() - overlayFadeOutAnimationDurationMs * 2
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
    const [_showState, setShowState] = useState<
        | {
              isShowing: true;
              pos: number;
              animation: "FadingIn" | "FadingOut" | null;
              extraOverlay: "LinkInput" | "HighlightSelector" | null;
          }
        | {isShowing: false; animation?: undefined}
    >({isShowing: false});

    let showState = _showState;

    // Update our show state whenever the selection changes while the toolbar
    // is open.
    if (shouldShow && showState.isShowing && showState.pos !== state.selection.from) {
        if (shouldShow) {
            showState = showState.isShowing
                ? {
                      ...showState,
                      pos: state.selection.from,
                      animation:
                          showState.animation === "FadingOut" ? "FadingIn" : showState.animation,
                      // Close the link input when the selection changes.
                      extraOverlay: null,
                  }
                : showState;
        }
    }

    // Close the toolbar if the position moves out of bounds.
    if (showState.isShowing && showState.pos >= state.doc.nodeSize) {
        showState = {isShowing: false};
    }

    // If we should stop showing then start the fade out animation.
    //
    // Ignore interaction modality when determining whether to close the toolbar.
    // If the toolbar opened in pointer interaction modality, we may switch to
    // keyboard interaction modality when editing a link.
    if (
        !shouldShowIgnoringInteractionModality &&
        showState.isShowing &&
        !showState.animation &&
        // If the link input is open then our focus moves to the link input. Don't
        // close the toolbar when this happens.
        showState.extraOverlay !== "LinkInput"
    ) {
        showState = {...showState, animation: "FadingOut"};
    }

    // Make sure we update our state with the new value.
    if (showState !== _showState) setShowState(showState);

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
                    extraOverlay: null,
                });
            }, overlayFadeInAnimationDurationMs);

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
            }, overlayFadeInAnimationDurationMs);
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
            }, 1000);

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
            isLinkInputOpen={showState.extraOverlay === "LinkInput"}
            onLinkInputOpen={() =>
                setShowState(prevState =>
                    prevState.isShowing
                        ? {...prevState, extraOverlay: "LinkInput" as const}
                        : prevState,
                )
            }
            onLinkInputClose={() =>
                setShowState(prevState =>
                    prevState.isShowing ? {...prevState, extraOverlay: null} : prevState,
                )
            }
            isHighlightSelectorOpen={showState.extraOverlay === "HighlightSelector"}
            onHighlightSelectorOpen={() =>
                setShowState(prevState =>
                    prevState.isShowing
                        ? {...prevState, extraOverlay: "HighlightSelector" as const}
                        : prevState,
                )
            }
            onHighlightSelectorClose={() =>
                setShowState(prevState =>
                    prevState.isShowing ? {...prevState, extraOverlay: null} : prevState,
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
    isHighlightSelectorOpen,
    onHighlightSelectorOpen,
    onHighlightSelectorClose,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    pos: number;
    animation: "FadingIn" | "FadingOut" | null;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
    isHighlightSelectorOpen: boolean;
    onHighlightSelectorOpen: () => void;
    onHighlightSelectorClose: () => void;
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
            isVisible={true}
            placement="top-start"
            // NOTE(calebmer): Ideally we wouldn't allow flipping since because we position
            // the toolbar at the start of the selection, flipping down will cover the
            // selection! However there are some scenarios where the toolbar would go
            // offscreen so it's better to flip and potentially cover content then to
            // occlude the toolbar.
            fallbackPlacements={["bottom-start"]}
            offset="3"
            offsetAlong="-4"
            overlay={
                <div
                    className={overlayAnimateContainerClassName}
                    style={{
                        // If we are animating, it's important the entire overlay has
                        // `pointer-events: none`. That way if the user is dragging to select text the
                        // overlay doesn't intercept pointer events and cause the drag to get wacky.
                        pointerEvents: animation !== null ? "none" : undefined,
                    }}
                >
                    <Box
                        data-testid="ContentEditorPointerToolbar"
                        display="flex"
                        paddingLeft="1"
                        paddingRight="0.5"
                        color="grey-100"
                        backgroundColor="grey-0"
                        borderRadius="1.5"
                        boxShadow="elevation-20"
                        className={classNames(
                            greyElevated2ClassName,
                            animation === "FadingIn"
                                ? overlayAnimateFadeInClassName
                                : animation === "FadingOut"
                                ? overlayAnimateFadeOutClassName
                                : undefined,
                        )}
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
                            isHighlightSelectorOpen={isHighlightSelectorOpen}
                            onHighlightSelectorOpen={onHighlightSelectorOpen}
                            onHighlightSelectorClose={onHighlightSelectorClose}
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
    isHighlightSelectorOpen,
    onHighlightSelectorOpen,
    onHighlightSelectorClose,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: Memo<(tooltipRef: TooltipRef) => () => void>;
    isFadingOut: boolean;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
    isHighlightSelectorOpen: boolean;
    onHighlightSelectorOpen: () => void;
    onHighlightSelectorClose: () => void;
}) {
    const {isAppleDevice} = useClientInfo();

    const isSelectionInCodeBlock = useMemo(() => {
        const {$from, $to} = state.selection;
        return (
            $from.parent.type.name === "codeBlockLine" || $to.parent.type.name === "codeBlockLine"
        );
    }, [state.selection]);

    const shouldDisableTooltips = isLinkInputOpen || isHighlightSelectorOpen;

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

    const isUnorderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(
                state.doc,
                state.selection,
                state.schema.nodes.unorderedListItem,
            ),
        [state.doc, state.schema.nodes.unorderedListItem, state.selection],
    );

    const isOrderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(state.doc, state.selection, state.schema.nodes.orderedListItem),
        [state.doc, state.schema.nodes.orderedListItem, state.selection],
    );

    return (
        <>
            <ContentEditorPointerToolbarButton
                description="Bold"
                keyboardShortcutHint={isAppleDevice ? "⌘+B" : "Ctrl+B"}
                viewRef={viewRef}
                isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={isBold}
                command={createToggleMarkCommand(state.schema.mark("bold"))}
            >
                <TextBolder />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Italic"
                keyboardShortcutHint={isAppleDevice ? "⌘+I" : "Ctrl+I"}
                viewRef={viewRef}
                isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={isItalic}
                command={createToggleMarkCommand(state.schema.mark("italic"))}
            >
                <TextItalic />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarButton
                description="Strikethrough"
                keyboardShortcutHint={isAppleDevice ? "⌘+Shift+X" : "Ctrl+Shift+X"}
                viewRef={viewRef}
                isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isActive={isStrike}
                command={createToggleMarkCommand(state.schema.mark("strike"))}
            >
                <TextStrikethrough />
            </ContentEditorPointerToolbarButton>
            <ContentEditorPointerToolbarLinkButton
                dividerRight={
                    !state.schema.marks.highlight &&
                    (!isSelectionInCodeBlock || !!state.schema.marks.comment)
                }
                state={state}
                viewRef={viewRef}
                isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                isToolbarFadingOut={isFadingOut}
                activeLinkMark={activeLinkMark}
                isLinkInputOpen={isLinkInputOpen}
                onLinkInputOpen={onLinkInputOpen}
                onLinkInputClose={onLinkInputClose}
            />
            {state.schema.marks.highlight && (
                <ContentEditorPointerToolbarHighlightButton
                    dividerRight={!isSelectionInCodeBlock || !!state.schema.marks.comment}
                    viewRef={viewRef}
                    isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    isToolbarFadingOut={isFadingOut}
                    activeHighlightMark={activeHighlightMark}
                    isHighlightSelectorOpen={isHighlightSelectorOpen}
                    onHighlightSelectorOpen={onHighlightSelectorOpen}
                    onHighlightSelectorClose={onHighlightSelectorClose}
                />
            )}
            {!isSelectionInCodeBlock && (
                <>
                    <ContentEditorPointerToolbarButton
                        dividerLeft
                        description="Bullet list"
                        keyboardShortcutHint="- Hello"
                        viewRef={viewRef}
                        isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                        sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        isActive={isUnorderedListItemActive}
                        command={createToggleListItemsCommand(state.schema.nodes.unorderedListItem)}
                    >
                        <ListBullets />
                    </ContentEditorPointerToolbarButton>
                    <ContentEditorPointerToolbarButton
                        dividerRight={
                            !state.schema.nodes.checkListItem && !!state.schema.nodes.heading
                        }
                        description="Number list"
                        keyboardShortcutHint="1. Hello"
                        viewRef={viewRef}
                        isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                        sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        isActive={isOrderedListItemActive}
                        command={createToggleListItemsCommand(state.schema.nodes.orderedListItem)}
                    >
                        <ListNumbers />
                    </ContentEditorPointerToolbarButton>
                </>
            )}
            {state.schema.nodes.checkListItem && !isSelectionInCodeBlock && (
                <ContentEditorPointerToolbarButton
                    dividerRight={!!state.schema.nodes.heading}
                    description="Check list"
                    keyboardShortcutHint="[ ] Hello"
                    viewRef={viewRef}
                    isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    isActive={isCheckListActive}
                    command={createToggleListItemsCommand(state.schema.nodes.checkListItem)}
                >
                    <ListChecks />
                </ContentEditorPointerToolbarButton>
            )}
            {state.schema.nodes.heading && !isSelectionInCodeBlock && (
                <>
                    <ContentEditorPointerToolbarButton
                        dividerLeft
                        description="Heading 1"
                        keyboardShortcutHint="# Hello"
                        viewRef={viewRef}
                        isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
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
                        keyboardShortcutHint="## Hello"
                        viewRef={viewRef}
                        isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                        sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                        isActive={isHeadingLevel2Active}
                        command={createToggleBlockTypeCommand(state.schema.nodes.heading, {
                            level: 2,
                        })}
                    >
                        <TextHTwo />
                    </ContentEditorPointerToolbarButton>
                    <ContentEditorPointerToolbarButton
                        dividerRight={!!state.schema.marks.comment}
                        description="Heading 3"
                        keyboardShortcutHint="### Hello"
                        viewRef={viewRef}
                        isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
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
            {state.schema.marks.comment && (
                <ContentEditorPointerToolbarButton
                    dividerLeft
                    description="Comment"
                    keyboardShortcutHint={isAppleDevice ? "⌘+Shift+C" : "Ctrl+Shift+C"}
                    viewRef={viewRef}
                    isTooltipDisabledWithoutAnimation={shouldDisableTooltips}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    isActive={false}
                    command={(state, dispatch) => {
                        let isCommentSupported = false;
                        state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
                            if (!node.inlineContent) return;
                            isCommentSupported ||=
                                !!state.schema.marks.comment &&
                                node.type.allowsMarkType(state.schema.marks.comment);
                        });

                        if (!isCommentSupported) return false;

                        dispatch?.(state.tr.setMeta(openCommentInputFloaterMetaKey, true));
                        return true;
                    }}
                >
                    <ChatCircleText />
                </ContentEditorPointerToolbarButton>
            )}
        </>
    );
}

function ContentEditorPointerToolbarButton({
    description,
    keyboardShortcutHint,
    viewRef,
    isTooltipDisabledWithoutAnimation,
    sharedTooltipLifecycleRef,
    isActive,
    command,
    children,
    dividerLeft,
    dividerRight,
    onTooltipStateChange,
}: {
    description: string;
    keyboardShortcutHint: string;
    viewRef: RefObject<EditorView | null>;
    isTooltipDisabledWithoutAnimation: boolean;
    sharedTooltipLifecycleRef: Memo<(tooltipRef: TooltipRef) => () => void>;
    isActive: boolean;
    command: Command;
    children: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    onTooltipStateChange?: (state: TooltipState) => void;
}) {
    const onPress = () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch.bind(view), view);
    };

    const localRef = useRef<HTMLDivElement>(null);

    const {pressProps, isPressed} = usePress({
        ref: localRef,
        preventFocusOnPress: true,
        onPress,
    });

    const {hoverProps, isHovered} = useHover({});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip
            ref={useLifecycleRef(sharedTooltipLifecycleRef)}
            isDisabledWithoutAnimation={isTooltipDisabledWithoutAnimation}
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            fallbackPlacements={[]}
            content={
                <Box paddingY="0.5">
                    {description}
                    <Box color="grey-50">{keyboardShortcutHint}</Box>
                </Box>
            }
            onStateChange={onTooltipStateChange}
        >
            <div
                {...mergeProps(pressProps, hoverProps)}
                ref={localRef}
                aria-label={description}
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
                    borderRight={dividerRight ? "grey-5" : undefined}
                    paddingLeft={dividerLeft ? "1" : undefined}
                >
                    <Box
                        padding="1"
                        borderRadius="1"
                        color={isPressed || isActive ? "grey-100" : "grey-70"}
                        backgroundColor={
                            isPressedAndActive
                                ? "grey-20"
                                : isPressed || isActive
                                ? "grey-10"
                                : isHovered
                                ? "grey-5"
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
    isTooltipDisabledWithoutAnimation,
    sharedTooltipLifecycleRef,
    isToolbarFadingOut,
    activeLinkMark,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
    dividerLeft,
    dividerRight,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    isTooltipDisabledWithoutAnimation: boolean;
    sharedTooltipLifecycleRef: Memo<(tooltipRef: TooltipRef) => () => void>;
    isToolbarFadingOut: boolean;
    activeLinkMark: Mark | null;
    isLinkInputOpen: boolean;
    onLinkInputOpen: () => void;
    onLinkInputClose: () => void;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const {isAppleDevice} = useClientInfo();

    const buttonContainerRef = useRef<HTMLDivElement>(null);

    const range = useMemo(
        () => trimSpacesFromProsemirrorRange(state.doc, state.selection),
        [state.doc, state.selection],
    );

    const [isTooltipOpenAndNotAnimating, setIsTooltipOpenAndNotAnimating] = useState(false);

    return (
        <OverlayAnimated
            isVisible={isLinkInputOpen && !isToolbarFadingOut}
            placement="top"
            fallbackPlacements={[]}
            offset="1.5"
            // Don't animate if we have an open tooltip. It looks weird if the tooltip
            // immediately disappears then this overlay moves in.
            disableAnimation={isTooltipOpenAndNotAnimating}
            overlay={
                <Box
                    ref={useOutsidePress(event => {
                        const view = assertExists(viewRef.current);
                        const buttonContainerElement = assertExists(buttonContainerRef.current);

                        if (
                            event.target instanceof Element &&
                            isElementOwnedBy(assertExists(view.dom.parentElement), event.target)
                        ) {
                            // Flush sync here because we need our `isFocused` state to be true before the
                            // link input closes. That way the pointer toolbar itself won't disappear.
                            flushSync(() => {
                                view.dom.focus({preventScroll: true});
                            });
                        }

                        // Clicking the button again while it's open will close the overlay.
                        if (
                            event.target instanceof Element &&
                            buttonContainerElement.contains(event.target)
                        ) {
                            return;
                        }

                        onLinkInputClose();
                    })}
                >
                    <ContentEditorLinkInput
                        viewRef={viewRef}
                        range={range}
                        mark={activeLinkMark}
                        autoFocus={true}
                        onClose={() => {
                            assertExists(viewRef.current).dom.focus({preventScroll: true});
                            onLinkInputClose();
                        }}
                    />
                </Box>
            }
        >
            <Box ref={buttonContainerRef}>
                <ContentEditorPointerToolbarButton
                    dividerLeft={dividerLeft}
                    dividerRight={dividerRight}
                    description="Link"
                    keyboardShortcutHint={isAppleDevice ? "⌘+K" : "Ctrl+K"}
                    isActive={isLinkInputOpen || !!activeLinkMark}
                    isTooltipDisabledWithoutAnimation={
                        isTooltipDisabledWithoutAnimation || isLinkInputOpen
                    }
                    viewRef={viewRef}
                    sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                    command={() => {
                        if (isLinkInputOpen) {
                            onLinkInputClose();
                        } else {
                            onLinkInputOpen();
                        }

                        return false;
                    }}
                    onTooltipStateChange={state =>
                        setIsTooltipOpenAndNotAnimating(
                            (state.isFocused || state.isHovered) &&
                                !state.isFadingIn &&
                                !state.isFadingOut,
                        )
                    }
                >
                    <LinkIcon />
                </ContentEditorPointerToolbarButton>
            </Box>
        </OverlayAnimated>
    );
}

function ContentEditorPointerToolbarHighlightButton({
    viewRef,
    isTooltipDisabledWithoutAnimation,
    sharedTooltipLifecycleRef,
    isToolbarFadingOut,
    activeHighlightMark,
    isHighlightSelectorOpen,
    onHighlightSelectorOpen,
    onHighlightSelectorClose,
    dividerRight,
    dividerLeft,
}: {
    viewRef: RefObject<EditorView | null>;
    isTooltipDisabledWithoutAnimation: boolean;
    sharedTooltipLifecycleRef: Memo<(tooltipRef: TooltipRef) => () => void>;
    isToolbarFadingOut: boolean;
    activeHighlightMark: Mark | null;
    isHighlightSelectorOpen: boolean;
    onHighlightSelectorOpen: () => void;
    onHighlightSelectorClose: () => void;
    dividerRight?: boolean;
    dividerLeft?: boolean;
}) {
    const {isAppleDevice} = useClientInfo();

    const buttonContainerRef = useRef<HTMLDivElement>(null);

    const [isTooltipOpenAndNotAnimating, setIsTooltipOpenAndNotAnimating] = useState(false);

    return (
        <OverlayAnimated
            isVisible={isHighlightSelectorOpen && !isToolbarFadingOut}
            placement="top"
            fallbackPlacements={[]}
            offset="1.5"
            // Don't animate if we have an open tooltip. It looks weird if the tooltip
            // immediately disappears then this overlay moves in.
            disableAnimation={isTooltipOpenAndNotAnimating}
            overlay={
                <Box
                    ref={useOutsidePress(event => {
                        const buttonContainerElement = assertExists(buttonContainerRef.current);

                        // Clicking the button again while it's open will close the overlay.
                        if (
                            event.target instanceof Element &&
                            buttonContainerElement.contains(event.target)
                        ) {
                            return;
                        }

                        onHighlightSelectorClose();
                    })}
                >
                    <ContentEditorHighlightSelector
                        viewRef={viewRef}
                        mark={activeHighlightMark}
                        isFocusable={false}
                        onClose={onHighlightSelectorClose}
                    />
                </Box>
            }
        >
            <Box ref={buttonContainerRef}>
                <ContentEditorPointerToolbarButton
                    dividerRight={dividerRight}
                    dividerLeft={dividerLeft}
                    description="Highlight"
                    keyboardShortcutHint={isAppleDevice ? "⌘+Shift+H" : "Ctrl+Shift+H"}
                    isActive={isHighlightSelectorOpen || !!activeHighlightMark}
                    isTooltipDisabledWithoutAnimation={
                        isTooltipDisabledWithoutAnimation || isHighlightSelectorOpen
                    }
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

                        if (isHighlightSelectorOpen) {
                            onHighlightSelectorClose();
                        } else {
                            onHighlightSelectorOpen();
                        }

                        return false;
                    }}
                    onTooltipStateChange={state =>
                        setIsTooltipOpenAndNotAnimating(
                            (state.isFocused || state.isHovered) &&
                                !state.isFadingIn &&
                                !state.isFadingOut,
                        )
                    }
                >
                    <Palette />
                </ContentEditorPointerToolbarButton>
            </Box>
        </OverlayAnimated>
    );
}

/**
 * Does this ProseMirror slice exclusively contain the boundary between two
 * nodes? With no content in between?
 *
 * In the editor boundaries between block nodes are rendered as a newline. So
 * this returns true when the user has selected a newline.
 */
function isNodeBoundarySlice(slice: Slice): boolean {
    if (slice.openStart === 0) return false;
    if (slice.openEnd === 0) return false;

    if (slice.content.content.length !== 2) return false;

    let firstNode = slice.content.content[0]!;
    let secondNode = slice.content.content[1]!;

    let openStart = slice.openStart - 1;
    let openEnd = slice.openEnd - 1;

    while (openStart > 0) {
        if (firstNode.content.content.length !== 1) return false;
        firstNode = firstNode.content.content[0]!;
        openStart--;
    }

    while (openEnd > 0) {
        if (secondNode.content.content.length !== 1) return false;
        secondNode = secondNode.content.content[0]!;
        openEnd--;
    }

    return firstNode.childCount === 0 && secondNode.childCount === 0;
}
