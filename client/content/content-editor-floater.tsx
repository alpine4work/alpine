import {setInteractionModality} from "@react-aria/interactions";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useRef, useState} from "react";
import {FocusScope} from "react-aria";
import {ContentEditorCursorTracker} from "~/client/content/content-editor-cursor-tracker";
import {
    ContentEditorHighlightSelector,
    ContentEditorHighlightSelectorRef,
} from "~/client/content/content-editor-highlight-selector";
import {ContentEditorLinkInput} from "~/client/content/content-editor-link-input";
import {ContentEditorPointerToolbar} from "~/client/content/content-editor-pointer-toolbar";
import {Box} from "~/client/design/box";
import {useOutsidePress} from "~/client/design/helpers/use-outside-press";
import {OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay-animated";
import {overlayFadeAnimationDurationMs} from "~/client/design/overlay-animated.css";
import {useConstant} from "~/client/helpers/lifecycle/use-constant";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

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
    readonly pos: number;
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
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    floaterState: ContentEditorFloaterState;
    setFloaterState: (floaterState: ContentEditorFloaterState) => void;
}) {
    switch (floaterState.type) {
        case "PointerToolbar": {
            return <ContentEditorPointerToolbar state={state} viewRef={viewRef} />;
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
            // TODO
            return null;
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

    const pos = useConstant(state.selection.from);

    const [isClosing, setIsClosing] = useState(false);

    const onClose = () => {
        assert(viewRef.current);
        viewRef.current.focus();
        setIsClosing(true);
    };

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                _onClose();
            }, overlayFadeAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, _onClose]);

    useEffect(() => {
        if (state.selection.from !== pos) {
            onClose();
        }
    });

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
                        isFocusable={!isClosing}
                        onClose={onClose}
                    />
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={pos}
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

    const pos = useConstant(state.selection.from);

    const [isClosing, setIsClosing] = useState(false);

    const onClose = () => {
        assert(viewRef.current);
        viewRef.current.focus();
        setIsClosing(true);
    };

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                _onClose();
            }, overlayFadeAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, _onClose]);

    useEffect(() => {
        if (state.selection.from !== pos) {
            onClose();
        }
    });

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
                            isDisabled={true}
                            onClose={onClose}
                        />
                    ) : (
                        <FocusScope contain restoreFocus autoFocus>
                            <ContentEditorLinkInput viewRef={viewRef} onClose={onClose} />
                        </FocusScope>
                    )}
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={pos}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}
