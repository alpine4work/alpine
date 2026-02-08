import {useHover} from "@react-aria/interactions";
import {Mark} from "prosemirror-model";
import {EditorState, Selection} from "prosemirror-state";
import {DecorationSet, EditorView} from "prosemirror-view";
import {
    Dispatch,
    Memo,
    RefObject,
    SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {FocusScope} from "react-aria";
import {ContentEditorCommentInputFloater} from "~/client/web/content/internal/content_editor_comment_input_floater.js";
import {ContentEditorCursorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {
    ContentEditorHighlightSelector,
    ContentEditorHighlightSelectorRef,
} from "~/client/web/content/internal/content_editor_highlight_selector.js";
import {ContentEditorLinkInput} from "~/client/web/content/internal/content_editor_link_input.js";
import {
    ContentEditorMentionFloater,
    ContentEditorMentionFloaterSectionOrder,
} from "~/client/web/content/internal/content_editor_mention_floater.js";
import {ContentEditorPointerToolbar} from "~/client/web/content/internal/content_editor_pointer_toolbar.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/web/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {FileInfoWithEntity} from "~/client/web/content/internal/iterate_file_infos_in_element.js";
import {ContentEditorFloaterState} from "~/client/web/content/state/content_editor_floater_state.js";
import {Box} from "~/client/web/design/box.js";
import {useOutsidePress} from "~/client/web/design/helpers/use_outside_interaction.js";
import {OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {overlayFadeOutAnimationDurationMs} from "~/client/web/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {Platform} from "~/shared/design/core/platform.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";

export function ContentEditorFloater({
    platform,
    state,
    accessLevel,
    viewRef,
    floaterState,
    setFloaterState,
    isFocused,
    hasSelectionEnteredWhenUnfocused,
    setDecorationCallbacks,
    commentFileAttachmentTarget,
    mentionFloaterSectionOrder,
    onPasteOrDropFiles,
}: {
    platform: Platform;
    state: EditorState & {schema: ContentProsemirrorSchema};
    accessLevel: AccessLevel;
    viewRef: RefObject<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
          })
        | null
    >;
    floaterState: ContentEditorFloaterState;
    setFloaterState: (floaterState: ContentEditorFloaterState) => void;
    isFocused: boolean;
    hasSelectionEnteredWhenUnfocused: boolean;
    setDecorationCallbacks: Dispatch<
        SetStateAction<
            ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
        >
    >;
    commentFileAttachmentTarget: Memo<FileAttachmentTarget> | undefined;
    mentionFloaterSectionOrder: ContentEditorMentionFloaterSectionOrder;
    // Optional callback to handle file entities when the content doesn't support file nodes.
    onPasteOrDropFiles?: (
        fileInfos: ReadonlyArray<FileInfoWithEntity>,
    ) => SafeFloatingPromise<void>;
}) {
    switch (floaterState.type) {
        case "PointerToolbar": {
            // The pointer toolbar never opens on mobile devices.
            if (platform === "mobile") return null;

            return (
                <ContentEditorPointerToolbar
                    state={state}
                    accessLevel={accessLevel}
                    viewRef={viewRef}
                    previousState={floaterState.previousState}
                    isFocused={isFocused}
                    hasSelectionEnteredWhenUnfocused={hasSelectionEnteredWhenUnfocused}
                    setDecorationCallbacks={setDecorationCallbacks}
                />
            );
        }
        case "KeyboardHighlight": {
            return (
                <ContentEditorKeyboardHighlightFloater
                    state={state}
                    viewRef={viewRef}
                    range={floaterState.range}
                    onClose={() =>
                        setFloaterState({type: "PointerToolbar", previousState: floaterState})
                    }
                />
            );
        }
        case "KeyboardLink": {
            return (
                <ContentEditorKeyboardLinkFloater
                    state={state}
                    viewRef={viewRef}
                    range={floaterState.range}
                    onClose={() =>
                        setFloaterState({type: "PointerToolbar", previousState: floaterState})
                    }
                />
            );
        }
        case "PointerLink": {
            return (
                <ContentEditorPointerLinkFloater
                    // Remount whenever the user hovers over a different mark.
                    key={floaterState.key}
                    state={state}
                    viewRef={viewRef}
                    accessLevel={accessLevel}
                    mark={floaterState.mark}
                    range={floaterState.range}
                    hasPointerLeftMark={floaterState.hasPointerLeftMark}
                    onClose={() =>
                        setFloaterState({type: "PointerToolbar", previousState: floaterState})
                    }
                />
            );
        }
        case "Mention": {
            return (
                <ContentEditorMentionFloater
                    state={state}
                    viewRef={viewRef}
                    range={floaterState.range}
                    searchQuery={floaterState.searchQuery}
                    handleKeyDownRef={floaterState.handleKeyDownRef}
                    isFocused={isFocused}
                    isClosing={floaterState.isClosing}
                    sectionOrder={mentionFloaterSectionOrder}
                    onCloseWithoutAnimation={() =>
                        setFloaterState({type: "PointerToolbar", previousState: floaterState})
                    }
                    onCloseWithAnimation={() => setFloaterState({...floaterState, isClosing: true})}
                    onPasteOrDropFiles={onPasteOrDropFiles}
                />
            );
        }
        case "CommentInput": {
            return (
                <ContentEditorCommentInputFloater
                    state={state}
                    viewRef={viewRef}
                    range={floaterState.range}
                    fileAttachmentTarget={assertExists(commentFileAttachmentTarget)}
                    onClose={() =>
                        setFloaterState({type: "PointerToolbar", previousState: floaterState})
                    }
                />
            );
        }
        default:
            throw exhaustive(floaterState);
    }
}

function ContentEditorKeyboardHighlightFloater({
    state,
    viewRef,
    range,
    onClose: _onActuallyClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);
    const selectorRef = useRef<ContentEditorHighlightSelectorRef>(null);

    const mark = useMemo(
        () =>
            getMarksSpanningAcrossEntireRange(state.doc, range).find(
                mark => mark.type.name === "highlight",
            ) ?? null,
        [range, state.doc],
    );

    const [isClosing, setIsClosing] = useState(false);

    const onClose = useCallback(() => {
        assert(viewRef.current);
        viewRef.current.dom.focus({preventScroll: true});
        setIsClosing(true);
    }, [viewRef]);

    const onActuallyClose = useEvent(_onActuallyClose);
    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onActuallyClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onActuallyClose]);

    useEffect(() => {
        selectorRef.current?.focus({preventScroll: true});
    }, []);

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // Also it looks a little better to not animate when replacing a possibly
            // existing toolbar.
            isVisible={!isClosing}
            disableAnimation={!isClosing}
            placement="top-start"
            offset="3"
            offsetAlong="-5"
            // It doesn't make sense for the toolbar to flip. Since if it's over a range of
            // text it'll always be at the beginning of the text. Always make sure the
            // `<ContentEditor>` has some space above it so the toolbar will never go
            // offscreen.
            fallbackPlacements={emptyArray}
            overlay={
                <Box
                    ref={useOutsidePress(onClose)}
                    onBlur={event => {
                        const element = event.currentTarget;

                        // Wait a microtask for the new focused element to be set. In case we are
                        // switching focus between two children within this element.
                        scheduleMicrotask(() => {
                            if (!element.contains(document.activeElement)) {
                                onClose();
                            }
                        });
                    }}
                    onKeyDown={event => {
                        switch (event.key) {
                            case "Escape":
                                event.preventDefault();
                                event.stopPropagation();
                                onClose();
                                break;
                            // If our keyboard color selector has focus you can't escape. Must hit escape
                            // or click out to get out.
                            case "Tab":
                                event.preventDefault();
                                break;
                        }
                    }}
                >
                    <ContentEditorHighlightSelector
                        ref={selectorRef}
                        viewRef={viewRef}
                        mark={mark}
                        isFocusable={!isClosing}
                        onClose={onClose}
                    />
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={range.from}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorKeyboardLinkFloater({
    state,
    viewRef,
    range,
    onClose: _onActuallyClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);

    const mark = useMemo(
        () =>
            getMarksSpanningAcrossEntireRange(state.doc, range).find(
                mark => mark.type.name === "link",
            ) ?? null,
        [range, state.doc],
    );

    const [isClosing, setIsClosing] = useState(false);

    const onClose = useCallback(() => {
        assert(viewRef.current);
        viewRef.current.dom.focus({preventScroll: true});
        setIsClosing(true);
    }, [viewRef]);

    const onActuallyClose = useEvent(_onActuallyClose);
    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onActuallyClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onActuallyClose]);

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // Also it looks a little better to not animate when replacing a possibly
            // existing toolbar.
            isVisible={!isClosing}
            disableAnimation={!isClosing}
            placement="top-start"
            offset="3"
            offsetAlong="-5"
            // It doesn't make sense for the toolbar to flip. Since if it's over a range of
            // text it'll always be at the beginning of the text. Always make sure the
            // `<ContentEditor>` has some space above it so the toolbar will never go
            // offscreen.
            fallbackPlacements={emptyArray}
            overlay={
                <Box
                    ref={useOutsidePress(onClose)}
                    // It's important the overlay is focusable for `<FocusScope contain>`. That way
                    // when you click into the overlay, focus goes to this element instead of
                    // `document.body`. If `<FocusScope contain>` sees focus on `document.body` then
                    // it will move focus right back to the element that was blurred which is not
                    // what the user wants.
                    tabIndex={-1}
                >
                    {isClosing ? (
                        <ContentEditorLinkInput
                            viewRef={viewRef}
                            range={range}
                            mark={mark}
                            isDisabled={true}
                            onClose={onClose}
                        />
                    ) : (
                        <FocusScope contain restoreFocus>
                            <ContentEditorLinkInput
                                viewRef={viewRef}
                                range={range}
                                mark={mark}
                                autoFocus={true}
                                onClose={onClose}
                            />
                        </FocusScope>
                    )}
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={range.from}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorPointerLinkFloater({
    state,
    viewRef,
    accessLevel,
    mark,
    range,
    hasPointerLeftMark,
    onClose: _onActuallyClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    accessLevel: AccessLevel;
    mark: Mark;
    range: {from: number; to: number};
    hasPointerLeftMark: boolean;
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);

    const [isClosing, setIsClosing] = useState(false);

    const onClose = useCallback(() => {
        setIsClosing(true);
    }, []);

    const onActuallyClose = useEvent(_onActuallyClose);
    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onActuallyClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onActuallyClose]);

    // If somehow our state change such that the range no longer corresponds to the
    // mark we are inspecting, close the floater.
    useEffect(() => {
        let totalNodeCount = 0;
        let nodeCountWithMark = 0;

        // Checks that the only node between `from` and `to` is a node with our mark.
        state.doc.nodesBetween(range.from, range.to, (node, pos) => {
            // Skip nodes that intersect with our range. We only care about nodes that are
            // completely within our range.
            if (pos < range.from || pos + node.nodeSize > range.to) return;

            totalNodeCount++;
            if (mark.isInSet(node.marks)) nodeCountWithMark++;
            return false;
        });

        if (totalNodeCount !== 1 || nodeCountWithMark !== 1) {
            onClose();
        }
    }, [mark, onClose, range.from, range.to, state.doc]);

    const {hoverProps, isHovered} = useHover({});

    // If the pointer leaves the mark and is not hovered over our link floater then
    // close the floater after a delay.
    useEffect(() => {
        if (hasPointerLeftMark && !isHovered) {
            const timeoutId = setTimeout(() => {
                onClose();
            }, 1000);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [hasPointerLeftMark, isHovered, onClose]);

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // Also it looks a little better to not animate when replacing a possibly
            // existing toolbar.
            isVisible={!isClosing}
            placement="top-start"
            // This floater is closer to the cursor than the others because it doesn't have
            // a visual text selection indication for what it's targeting.
            offset="1.5"
            offsetAlong="-5"
            // It doesn't make sense for the toolbar to flip. Since if it's over a range of
            // text it'll always be at the beginning of the text. Always make sure the
            // `<ContentEditor>` has some space above it so the toolbar will never go
            // offscreen.
            fallbackPlacements={emptyArray}
            overlay={
                <Box {...hoverProps} ref={useOutsidePress(onClose)}>
                    <ContentEditorLinkInput
                        viewRef={viewRef}
                        range={range}
                        mark={mark}
                        isDisabled={isClosing}
                        isReadOnly={!hasAccessLevel(accessLevel, "Edit")}
                        onClose={onClose}
                    />
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={range.from}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}
