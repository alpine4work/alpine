import {setInteractionModality, useHover} from "@react-aria/interactions";
import {Mark} from "prosemirror-model";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {FocusScope} from "react-aria";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker";
import {
    ContentEditorHighlightSelector,
    ContentEditorHighlightSelectorRef,
} from "~/client/content/internal/content_editor_highlight_selector";
import {ContentEditorLinkInput} from "~/client/content/internal/content_editor_link_input";
import {ContentEditorPointerToolbar} from "~/client/content/internal/content_editor_pointer_toolbar";
import {
    getMarksSpanningAcrossEntireRange,
    trimSpacesFromRange,
} from "~/client/content/internal/content_editor_prosemirror_helpers";
import {Box} from "~/client/design/box";
import {useOutsidePress} from "~/client/design/helpers/use_outside_press";
import {OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing_constants";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {overlayFadeOutAnimationDurationMs} from "~/shared/styles/styles";

export type ContentEditorPointerToolbarFloaterState = {
    readonly type: "PointerToolbar";
};

export type ContentEditorKeyboardHighlightFloaterState = {
    readonly type: "KeyboardHighlight";
};

export type ContentEditorKeyboardLinkFloaterState = {
    readonly type: "KeyboardLink";
};

export type ContentEditorPointerLinkFloaterState = {
    readonly type: "PointerLink";
    readonly mark: Mark;
    readonly range: {
        readonly from: number;
        readonly to: number;
    };
    readonly hasPointerLeftMark: boolean;
};

export type ContentEditorFloaterState =
    | ContentEditorPointerToolbarFloaterState
    | ContentEditorKeyboardHighlightFloaterState
    | ContentEditorKeyboardLinkFloaterState
    | ContentEditorPointerLinkFloaterState;

// We always revert back to the pointer toolbar floater since it controls when
// it is visible and when it is not visible. (Much of the time it's not.)
export const initialContentEditorFloaterState: ContentEditorFloaterState = {type: "PointerToolbar"};

export function ContentEditorFloater({
    state,
    viewRef,
    floaterState,
    setFloaterState,
    isFocused,
    lastSelectionChangeTransactionTime,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    floaterState: ContentEditorFloaterState;
    setFloaterState: (floaterState: ContentEditorFloaterState) => void;
    isFocused: boolean;
    lastSelectionChangeTransactionTime: number | null;
}) {
    switch (floaterState.type) {
        case "PointerToolbar": {
            return (
                <ContentEditorPointerToolbar
                    state={state}
                    viewRef={viewRef}
                    isFocused={isFocused}
                    lastSelectionChangeTransactionTime={lastSelectionChangeTransactionTime}
                />
            );
        }
        case "KeyboardHighlight": {
            return (
                <ContentEditorKeyboardHighlightFloater
                    state={state}
                    viewRef={viewRef}
                    onClose={() => setFloaterState(initialContentEditorFloaterState)}
                />
            );
        }
        case "KeyboardLink": {
            return (
                <ContentEditorKeyboardLinkFloater
                    state={state}
                    viewRef={viewRef}
                    onClose={() => setFloaterState(initialContentEditorFloaterState)}
                />
            );
        }
        case "PointerLink": {
            return (
                <ContentEditorPointerLinkFloater
                    key={floaterState.range.from}
                    state={state}
                    viewRef={viewRef}
                    mark={floaterState.mark}
                    range={floaterState.range}
                    hasPointerLeftMark={floaterState.hasPointerLeftMark}
                    onClose={() => setFloaterState(initialContentEditorFloaterState)}
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
    onClose: _onClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);
    const selectorRef = useRef<ContentEditorHighlightSelectorRef>(null);

    const range = useConstant(() => trimSpacesFromRange(state.doc, state.selection));

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
        viewRef.current.focus();
        setIsClosing(true);
    }, [viewRef]);

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                _onClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, _onClose]);

    useEffect(() => {
        const trimmedSelectionRange = trimSpacesFromRange(state.doc, state.selection);

        if (trimmedSelectionRange.from !== range.from || trimmedSelectionRange.to !== range.to) {
            onClose();
        }
    }, [onClose, range.from, range.to, state.doc, state.selection]);

    useEffect(() => {
        assert(selectorRef.current);

        // Change the interaction modality to keyboard so we see focus rings.
        // Otherwise the user won't know what color they are selecting.
        setInteractionModality("keyboard");

        selectorRef.current.focus({preventScroll: true});
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
            visible={!isClosing}
            disableAnimation={!isClosing}
            placement="top-start"
            offset="3"
            offsetAlong="-5"
            canFlip={false}
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
    onClose: _onClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);

    const range = useConstant(() => trimSpacesFromRange(state.doc, state.selection));

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
        viewRef.current.focus();
        setIsClosing(true);
    }, [viewRef]);

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                _onClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, _onClose]);

    useEffect(() => {
        const trimmedSelectionRange = trimSpacesFromRange(state.doc, state.selection);

        if (trimmedSelectionRange.from !== range.from || trimmedSelectionRange.to !== range.to) {
            onClose();
        }
    }, [onClose, range.from, range.to, state.doc, state.selection]);

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // Also it looks a little better to not animate when replacing a possibly
            // existing toolbar.
            visible={!isClosing}
            disableAnimation={!isClosing}
            placement="top-start"
            offset="3"
            offsetAlong="-5"
            canFlip={false}
            overlay={
                <Box ref={useOutsidePress(onClose)}>
                    {isClosing ? (
                        <ContentEditorLinkInput
                            viewRef={viewRef}
                            range={range}
                            mark={mark}
                            isDisabled={true}
                            onClose={onClose}
                        />
                    ) : (
                        <FocusScope contain restoreFocus autoFocus>
                            <ContentEditorLinkInput
                                viewRef={viewRef}
                                range={range}
                                mark={mark}
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
    mark,
    range,
    hasPointerLeftMark,
    onClose: _onClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
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

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                _onClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, _onClose]);

    // If the mark moves or changes after the component mounts then close our
    // floater.
    //
    // TODO(calebmer): Test how annoying this is with realtime editing! Maybe
    // we should try mapping to the new location first.
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
            }, uninterruptedThoughtLimitMs);
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
            visible={!isClosing}
            placement="top-start"
            // This floater is closer to the cursor than the others because it doesn't have
            // a visual text selection indication for what it's targeting.
            offset="1.5"
            offsetAlong="-5"
            canFlip={false}
            overlay={
                <Box {...hoverProps} ref={useOutsidePress(onClose)}>
                    <ContentEditorLinkInput
                        viewRef={viewRef}
                        range={range}
                        mark={mark}
                        isDisabled={isClosing}
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
