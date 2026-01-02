import {Modality, getInteractionModality, useHover, usePress} from "@react-aria/interactions";
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
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    Dispatch,
    Memo,
    ReactNode,
    RefObject,
    SetStateAction,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import {flushSync} from "react-dom";
import {ContentEditorCursorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {ContentEditorHighlightSelector} from "~/client/web/content/internal/content_editor_highlight_selector.js";
import {ContentEditorLinkInput} from "~/client/web/content/internal/content_editor_link_input.js";
import {areAllNodesBlockType} from "~/client/web/content/internal/helpers/are_all_nodes_block_type.js";
import {areAllNodesListItemType} from "~/client/web/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleBlockTypeCommand} from "~/client/web/content/internal/helpers/create_toggle_block_type_command.js";
import {createToggleListItemsCommand} from "~/client/web/content/internal/helpers/create_toggle_list_items_command.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/web/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {
    ContentEditorFloaterState,
    ContentEditorPointerToolbarFloaterState,
} from "~/client/web/content/state/content_editor_floater_state.js";
import {openContentEditorCommentInputFloaterMetaKey} from "~/client/web/content/state/content_editor_meta_keys.js";
import {getContentEditorSelectionGeneration} from "~/client/web/content/state/content_editor_state.js";
import {createToggleMarkCommand} from "~/client/web/content/state/create_toggle_mark_command.js";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/web/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {Box} from "~/client/web/design/box.js";
import {useIsContextMenuOpen} from "~/client/web/design/context_menu.js";
import {useOutsidePress} from "~/client/web/design/helpers/use_outside_interaction.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {Overlay, OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {Tooltip, TooltipRef, TooltipState} from "~/client/web/design/tooltip.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useLifecycleRef} from "~/client/web/helpers/refs/use_lifecycle_ref.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeInAnimationDurationMs,
    sprinkles,
    withoutClearSelectionOnMouseDownClassName,
} from "~/client/web/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {greyElevated2ClassName, linkClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorPointerToolbar({
    state,
    accessLevel,
    viewRef,
    previousState,
    isFocused,
    hasSelectionEnteredWhenUnfocused,
    setDecorationCallbacks,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    accessLevel: AccessLevel;
    viewRef: RefObject<EditorView | null>;
    previousState: Exclude<
        ContentEditorFloaterState,
        ContentEditorPointerToolbarFloaterState
    > | null;
    isFocused: boolean;
    hasSelectionEnteredWhenUnfocused: boolean;
    setDecorationCallbacks: Dispatch<
        SetStateAction<
            ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
        >
    >;
}) {
    const toolbarRef = useRef<HTMLDivElement>(null);

    // We keep track of our own `localInteractionModality` separate from
    // `react-aria`'s `interactionModality`. A user is still considered to have a
    // `pointer` `interactionModality` while they're typing in a text input
    // (because of a patch we make to `@react-aria/interactions`). It's only when
    // they explicitly press `Tab` that we switch to keyboard
    // `interactionModality`.
    //
    // However, for the purposes of hiding/showing the pointer toolbar we want any
    // typing within the content editor to hide the pointer toolbar. So we have our
    // own "local" interaction modality state.
    const [localInteractionModality, setLocalInteractionModality] =
        useState<Modality>(getInteractionModality);

    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);
        const viewElement = view.dom;

        const handleFocus = () => {
            // Whenever our editor is focused, update our local interaction modality to
            // match whatever the global interaction modality is.
            setLocalInteractionModality(getInteractionModality());
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                // Ignore keyboard shortcut key presses (like Ctrl+P which prints in browsers).
                // Unless its an arrow key press (like Shift+Alt+ArrowLeft which navigates one
                // word left on MacOS) which navigates the editor and should be considered the
                // user entering keyboard input mode.
                ((!event.metaKey && !event.ctrlKey && !event.altKey) ||
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "ArrowUp" ||
                    event.key === "ArrowDown") &&
                event.key !== "Control" &&
                event.key !== "Meta" &&
                event.key !== "Alt" &&
                // Ignore the shift key pressed alone. Pressing Shift+A for a capital "A"
                // should put us in keyboard input mode.
                event.key !== "Shift"
            ) {
                setLocalInteractionModality("keyboard");
            }
        };

        const handlePointerDown = () => {
            setLocalInteractionModality("pointer");
        };

        const handlePointerMove = () => {
            // Quality of life: If the user selects some text with their keyboard then
            // moves their mouse then we want to show the toolbar.
            setLocalInteractionModality("pointer");

            // Quality of life: If the user moves their pointer then we want to show the
            // toolbar instead of keeping it hidden. Since the user moving their pointer
            // may indicate they're looking to make a change.
            setMountSuppressionState(null);
        };

        viewElement.addEventListener("focus", handleFocus);
        viewElement.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("pointermove", handlePointerMove, true);
        return () => {
            viewElement.removeEventListener("focus", handleFocus);
            viewElement.removeEventListener("keydown", handleKeyDown, true);
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("pointermove", handlePointerMove, true);
        };
    }, [viewRef]);

    // If the pointer has moved while pressing down and the user has some text
    // selected, the user is probably trying to drag to change their selection. If
    // they are dragging then we don't want to show the toolbar since it won't have
    // much use. They can't click anything in the toolbar until they release
    // anyway.
    //
    // If we show the toolbar while dragging it jumps around awkwardly and blocks
    // pointer events from the mouse over content the user is potentially
    // dragging to.
    //
    // NOTE(calebmer): This state was copied into `<MessagingViewPointerToolbar>`.
    // If you make a change to this state here, you may want to make the same
    // change there.
    const [hasPointerMovedWhileDown, setHasPointerMovedWhileDown] = useState(false);

    // NOTE(calebmer): This state was copied into `<MessagingViewPointerToolbar>`.
    // If you make a change to this state here, you may want to make the same
    // change there.
    const [isWaitingForTripleClickAfterDoubleClick, setIsWaitingForTripleClickAfterDoubleClick] =
        useState(false);

    useEffect(() => {
        if (!isWaitingForTripleClickAfterDoubleClick) return;

        const timeout = createTimeout(() => {
            setIsWaitingForTripleClickAfterDoubleClick(false);
        }, doubleClickDelayMs);

        return () => timeout.clear();
    }, [isWaitingForTripleClickAfterDoubleClick]);

    const selection = useMemo(
        () => trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection),
        [state.selection],
    );

    const [mountSuppressionState, setMountSuppressionState] = useState(() => {
        // If the initial selection is different from the previous floater's range then
        // open the pointer toolbar.
        //
        // For example, say you hover over a link. When you double click on a word to
        // select it then after the link's floater closes (because it uses
        // `useOutsidePress(onClose)`) we want the toolbar to open.
        //
        // However, if you open the highlight selector then close it we don't want to
        // show the pointer toolbar until your selection moves.
        if (
            previousState !== null &&
            (previousState.range.from !== selection.$from.pos ||
                previousState.range.to !== selection.$to.pos)
        ) {
            return null;
        }

        return {selectionGeneration: getContentEditorSelectionGeneration(state)};
    });

    if (
        mountSuppressionState !== null &&
        mountSuppressionState.selectionGeneration !== getContentEditorSelectionGeneration(state)
    ) {
        setMountSuppressionState(null);
    }

    const isContextMenuOpen = useIsContextMenuOpen();

    const [contextMenuSuppressionState, setContextMenuSuppressionState] = useState<{
        selectionGeneration: number;
    } | null>(null);

    // Suppress the pointer toolbar while the context menu is open.
    //
    // NOTE(calebmer): Josh and I feel like it's a better experience when resolving
    // spellcheck errors if the pointer toolbar doesn't open right after you accept
    // (or ignore) a spellcheck issue. Are there other cases where it would be nice
    // to show the pointer toolbar after a right click? Maybe this should be scoped
    // specifically to spellcheck right click menus?
    if (
        isContextMenuOpen &&
        (contextMenuSuppressionState === null ||
            contextMenuSuppressionState.selectionGeneration !==
                getContentEditorSelectionGeneration(state))
    ) {
        setContextMenuSuppressionState({
            selectionGeneration: getContentEditorSelectionGeneration(state),
        });
    }

    // Stop suppressing the pointer toolbar after the context menu closes and the
    // selection moves.
    if (
        !isContextMenuOpen &&
        contextMenuSuppressionState !== null &&
        contextMenuSuppressionState.selectionGeneration !==
            getContentEditorSelectionGeneration(state)
    ) {
        setContextMenuSuppressionState(null);
    }

    const shouldShowCommentOnly: boolean = useMemo(
        () =>
            !!state.schema.marks.comment &&
            hasAccessLevel(accessLevel, "Comment") &&
            !hasAccessLevel(accessLevel, "Edit"),
        [accessLevel, state.schema.marks.comment],
    );

    const shouldShowIgnoringInteractionModality = useMemo(() => {
        return (
            (isFocused || (shouldShowCommentOnly && hasSelectionEnteredWhenUnfocused)) &&
            // Don't show while the context menu is open.
            !isContextMenuOpen &&
            // Don't show while we're suppressed after the context menu has closed and
            // before the selection has changed.
            contextMenuSuppressionState === null &&
            // Make sure some characters are selected before showing the selection toolbar.
            selection.$from.pos !== selection.$to.pos &&
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
            //
            // TODO(calebmer): Do we need this anymore now that we have
            // `trimSelectionInvisibleExtensionIntoAdjacentNodes()`? I'd expect boundary
            // selections to become empty?
            !isNodeBoundarySlice(state.doc.slice(state.selection.from, state.selection.to)) &&
            // Don't show the toolbar if the selection overlaps with the title. The title
            // can only be at the beginning of a document so checking whether
            // `selection.from` is in the title is sufficient for detecting overlap.
            selection.$from.parent.type.name !== "title" &&
            // Don't show the toolbar if the user's pointer is dragging to select text.
            !hasPointerMovedWhileDown &&
            // If the user has double clicked (to select a word) then we wait to see if
            // they triple click (to select a paragraph) before showing the pointer
            // toolbar. Otherwise it looks a little glitchy to see the toolbar appear then
            // immediately jump to the beginning of the paragraph.
            !isWaitingForTripleClickAfterDoubleClick
        );
    }, [
        contextMenuSuppressionState,
        hasPointerMovedWhileDown,
        hasSelectionEnteredWhenUnfocused,
        isContextMenuOpen,
        isFocused,
        isWaitingForTripleClickAfterDoubleClick,
        selection.$from.parent.type.name,
        selection.$from.pos,
        selection.$to.pos,
        shouldShowCommentOnly,
        state.doc,
        state.selection,
    ]);

    const shouldShow =
        shouldShowIgnoringInteractionModality &&
        // The toolbar overlay is intended for pointer use only. You can use keyboard
        // shortcuts to accomplish everything in the toolbar.
        localInteractionModality === "pointer" &&
        // Don't show the toolbar until the user has interacted with the editor.
        //
        // This defends against the case where we had a highlight toolbar opened but
        // then the user closed it and the regular toolbar wants to immediately open.
        mountSuppressionState === null;

    useLayoutEffect(() => {
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
                // Ignore clicks outside of our `EditorView` for triple click detection
                // purposes. This will happen in integration tests where we click in a document
                // then the pointer toolbar in rapid succession.
                event.target instanceof Node &&
                viewRef.current?.dom.contains(event.target)
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
    }, [viewRef]);

    // Once we should no longer show the toolbar, we still show it for a couple
    // milliseconds as it animates away.
    //
    // When `shouldShow` is false, `showState.isShowing` will be true for a couple
    // milliseconds and `showState.selectionPos` will be the last selection position.
    //
    // NOTE(calebmer): This component was written before `<OverlayAnimated>`. It
    // has a bit of delay before the animation begins so it isn't quite feature
    // compatible but consider consolidating someday.
    const [actualShowState, setShowState] = useState<
        | {
              isShowing: true;
              selectionFrom: number;
              selectionTo: number;
              animation: "FadingIn" | "FadingOut" | null;
              extraOverlay: "LinkInput" | "HighlightSelector" | null;
          }
        | {isShowing: false; animation?: undefined; extraOverlay?: undefined}
    >({isShowing: false});

    let showState = actualShowState;

    // Update our show state whenever the selection changes while the toolbar
    // is open.
    if (
        shouldShow &&
        showState.isShowing &&
        (showState.selectionFrom !== selection.$from.pos ||
            showState.selectionTo !== selection.$to.pos)
    ) {
        showState = showState.isShowing
            ? {
                  ...showState,
                  selectionFrom: selection.$from.pos,
                  selectionTo: selection.$to.pos,
                  animation: showState.animation === "FadingOut" ? "FadingIn" : showState.animation,
                  // Close the link input when the selection changes.
                  extraOverlay: null,
              }
            : showState;
    }

    // Close the toolbar if the position moves out of bounds.
    if (showState.isShowing && showState.selectionFrom >= state.doc.nodeSize) {
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
        // If the context menu was opened then immediately hide without fading out.
        // Since the context menu opens immediately so it looks weird for both to be
        // onscreen at once.
        if (isContextMenuOpen) {
            showState = {isShowing: false};
        } else {
            showState = {...showState, animation: "FadingOut"};
        }
    }

    // Make sure we update our state with the new value.
    if (showState !== actualShowState) setShowState(showState);

    useEffect(() => {
        if (shouldShow && !showState.isShowing) {
            const timeoutId = setTimeout(() => {
                setShowState({
                    isShowing: true,
                    selectionFrom: selection.$from.pos,
                    selectionTo: selection.$to.pos,
                    animation: "FadingIn",
                    extraOverlay: null,
                });
            }, overlayFadeInAnimationDurationMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [selection.$from.pos, selection.$to.pos, shouldShow, showState.isShowing]);

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

    // When the content editor is unfocused and there's a link input overlay open in
    // the pointer toolbar then give the editor's selection some style so the user
    // knows what the floater is editing.
    useLayoutEffect(() => {
        if (!showState.isShowing || showState.extraOverlay !== "LinkInput") return;

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(state.doc, [
                Decoration.inline(state.selection.from, state.selection.to, {
                    class: linkClassName,
                }),
            ]);
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                if (!decorationCallbacks.has(decorationCallback)) return decorationCallbacks;
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [setDecorationCallbacks, showState.extraOverlay, showState.isShowing]);

    if (!showState.isShowing) return null;

    return (
        <ContentEditorPointerToolbarOverlay
            state={state}
            viewRef={viewRef}
            toolbarRef={toolbarRef}
            selectionFrom={Math.min(state.doc.nodeSize - 2, showState.selectionFrom)}
            selectionTo={Math.min(state.doc.nodeSize - 2, showState.selectionTo)}
            animation={showState.animation}
            shouldShowCommentOnly={shouldShowCommentOnly}
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
    toolbarRef,
    selectionFrom,
    selectionTo,
    animation,
    shouldShowCommentOnly,
    isLinkInputOpen,
    onLinkInputOpen,
    onLinkInputClose,
    isHighlightSelectorOpen,
    onHighlightSelectorOpen,
    onHighlightSelectorClose,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    toolbarRef: RefObject<HTMLDivElement | null>;
    selectionFrom: number;
    selectionTo: number;
    animation: "FadingIn" | "FadingOut" | null;
    shouldShowCommentOnly: boolean;
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
            // The pointer toolbar needs to flip to the bottom if it would otherwise
            // conflict with the navigation bar. For example, try opening a post view on
            // desktop then editing the post, then selecting text at the top of the post.
            // The toolbar needs to flip down.
            fallbackPlacements={["bottom-start"]}
            overflowTop={navigationBarHeight}
            // Selected so when we're in a `<MessageInput>` the toolbar just overlaps the
            // top border of the input.
            offset="2.5"
            offsetAlong={shouldShowCommentOnly ? "-1" : "-4"}
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
                        ref={toolbarRef}
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
                            // Don't clear the selection when clicking in the toolbar since the toolbar
                            // references the selection.
                            withoutClearSelectionOnMouseDownClassName,
                            animation === "FadingIn"
                                ? overlayAnimateFadeInClassName
                                : animation === "FadingOut"
                                ? overlayAnimateFadeOutClassName
                                : undefined,
                        )}
                        style={{marginLeft: -1, marginRight: -1}}
                    >
                        {shouldShowCommentOnly ? (
                            <ContentEditorPointerToolbarButtonsCommentOnly
                                viewRef={viewRef}
                                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                            />
                        ) : (
                            <ContentEditorPointerToolbarButtons
                                state={state}
                                viewRef={viewRef}
                                selectionFrom={selectionFrom}
                                selectionTo={selectionTo}
                                sharedTooltipLifecycleRef={sharedTooltipLifecycleRef}
                                isFadingOut={animation === "FadingOut"}
                                isLinkInputOpen={isLinkInputOpen}
                                onLinkInputOpen={onLinkInputOpen}
                                onLinkInputClose={onLinkInputClose}
                                isHighlightSelectorOpen={isHighlightSelectorOpen}
                                onHighlightSelectorOpen={onHighlightSelectorOpen}
                                onHighlightSelectorClose={onHighlightSelectorClose}
                            />
                        )}
                    </Box>
                </div>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={useMemo(
                    () => ({from: selectionFrom, to: selectionTo}),
                    [selectionFrom, selectionTo],
                )}
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
    selectionFrom,
    selectionTo,
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
    selectionFrom: number;
    selectionTo: number;
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

    // IMPORTANT: Use `toolbarSelection` instead of `state.selection`. If the
    // selection changes the toolbar may fade out. But we want to continue showing
    // buttons for the old selection. The old selection will be maintained in
    // `toolbarSelection`.
    //
    // Commands still end up using `state.selection`. But this is fine since
    // commands shouldn't be run while the toolbar is fading out.
    const toolbarSelection = useMemo(() => {
        return {
            from: selectionFrom,
            to: selectionTo,
            $from: state.doc.resolve(selectionFrom),
            $to: state.doc.resolve(selectionTo),
        };
    }, [selectionFrom, selectionTo, state.doc]);

    const isSelectionInCodeBlock = useMemo(() => {
        return (
            toolbarSelection.$from.parent.type.name === "codeBlockLine" ||
            toolbarSelection.$to.parent.type.name === "codeBlockLine"
        );
    }, [toolbarSelection]);

    const shouldDisableTooltips = isLinkInputOpen || isHighlightSelectorOpen;

    const {isBold, isItalic, isStrike, activeLinkMark, activeHighlightMark} = useMemo(() => {
        const marks = getMarksSpanningAcrossEntireRange(state.doc, toolbarSelection);

        const activeLinkMark = marks.find(mark => mark.type.name === "link") ?? null;
        const activeHighlightMark = marks.find(mark => mark.type.name === "highlight") ?? null;

        return {
            isBold: state.schema.mark("bold").isInSet(marks),
            isItalic: state.schema.mark("italic").isInSet(marks),
            isStrike: state.schema.mark("strike").isInSet(marks),
            activeLinkMark,
            activeHighlightMark,
        };
    }, [state.doc, state.schema, toolbarSelection]);

    const isCheckListActive = useMemo(
        () =>
            !!state.schema.nodes.checkListItem &&
            areAllNodesListItemType(state.doc, toolbarSelection, state.schema.nodes.checkListItem),
        [state.doc, state.schema.nodes.checkListItem, toolbarSelection],
    );

    const isHeadingLevel1Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, toolbarSelection, state.schema.nodes.heading, {
                level: 1,
            }),
        [state.doc, state.schema.nodes.heading, toolbarSelection],
    );

    const isHeadingLevel2Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, toolbarSelection, state.schema.nodes.heading, {
                level: 2,
            }),
        [state.doc, state.schema.nodes.heading, toolbarSelection],
    );

    const isHeadingLevel3Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, toolbarSelection, state.schema.nodes.heading, {
                level: 3,
            }),
        [state.doc, state.schema.nodes.heading, toolbarSelection],
    );

    const isUnorderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(
                state.doc,
                toolbarSelection,
                state.schema.nodes.unorderedListItem,
            ),
        [state.doc, state.schema.nodes.unorderedListItem, toolbarSelection],
    );

    const isOrderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(
                state.doc,
                toolbarSelection,
                state.schema.nodes.orderedListItem,
            ),
        [state.doc, state.schema.nodes.orderedListItem, toolbarSelection],
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

                        dispatch?.(
                            state.tr.setMeta(openContentEditorCommentInputFloaterMetaKey, true),
                        );
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
    withoutDescriptionTooltip,
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
    withoutDescriptionTooltip?: boolean;
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
        command(view.state, view.dispatch, view);
    };

    const localRef = useRef<HTMLDivElement>(null);

    const {pressProps, isPressed} = usePress({
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        ref: localRef,
        preventFocusOnPress: true,
        onPress,
    });

    const {hoverProps, isHovered} = useHover({});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const isPressedAndActive = useStateWithDependenciesWithoutDispatch(
        ([isPressed]) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip
            ref={useLifecycleRef(sharedTooltipLifecycleRef)}
            isDisabledWithoutAnimation={isTooltipDisabledWithoutAnimation}
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            fallbackPlacements={emptyArray}
            content={
                withoutDescriptionTooltip ? (
                    <Box color="grey-50">{keyboardShortcutHint}</Box>
                ) : (
                    <Box paddingY="0.5">
                        {description}
                        <Box color="grey-50">{keyboardShortcutHint}</Box>
                    </Box>
                )
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
                        const dispatch = viewRef.current.dispatch;

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

function ContentEditorPointerToolbarButtonsCommentOnly({
    viewRef,
    sharedTooltipLifecycleRef,
}: {
    viewRef: RefObject<EditorView | null>;
    sharedTooltipLifecycleRef: Memo<(tooltipRef: TooltipRef) => () => void>;
}) {
    const {isAppleDevice} = useClientInfo();

    return (
        <ContentEditorPointerToolbarButton
            description="Comment"
            withoutDescriptionTooltip={true}
            keyboardShortcutHint={isAppleDevice ? "⌘+Shift+C" : "Ctrl+Shift+C"}
            viewRef={viewRef}
            isTooltipDisabledWithoutAnimation={false}
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

                dispatch?.(state.tr.setMeta(openContentEditorCommentInputFloaterMetaKey, true));
                return true;
            }}
        >
            <Box display="flex" gap="1">
                <ChatCircleText />
                <Box color="grey-100">Comment</Box>
            </Box>
        </ContentEditorPointerToolbarButton>
    );
}
