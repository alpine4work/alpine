import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useCallback, useEffect, useRef, useState} from "react";
import {FocusScope} from "react-aria";
import {ContentEditorCursorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {ContentEditorGifPicker} from "~/client/web/content/internal/content_editor_gif_picker.js";
import {Box} from "~/client/web/design/box.js";
import {useOutsidePress} from "~/client/web/design/helpers/use_outside_interaction.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {overlayFadeOutAnimationDurationMs} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.open_source.js";

/**
 * Floater wrapper for the GIF picker. On desktop, renders as an `OverlayAnimated`
 * anchored to the cursor position. On mobile, renders as a
 * `MobileFullScreenModal`.
 */
export function ContentEditorGifPickerFloater({
    platform,
    state,
    viewRef,
    onSelectGif,
    onClose,
}: {
    platform: Platform;
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onSelectGif: (url: URL) => void;
    onClose: () => void;
}) {
    if (platform === "mobile") {
        return (
            <ContentEditorGifPickerMobileFloater
                viewRef={viewRef}
                onSelectGif={onSelectGif}
                onClose={onClose}
            />
        );
    }

    return (
        <ContentEditorGifPickerDesktopFloater
            state={state}
            viewRef={viewRef}
            onSelectGif={onSelectGif}
            onClose={onClose}
        />
    );
}

function ContentEditorGifPickerDesktopFloater({
    state,
    viewRef,
    onSelectGif,
    onClose: _onActuallyClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onSelectGif: (url: URL) => void;
    onClose: () => void;
}) {
    const [isClosing, setIsClosing] = useState(false);
    const overlayRef = useRef<OverlayRef>(null);

    // Capture the cursor position when the picker opens so it stays anchored even if
    // the selection moves.
    const [anchorPos] = useState(() => state.selection.from);

    const onClose = useCallback(() => {
        if (viewRef.current) {
            viewRef.current.dom.focus({preventScroll: true});
        }
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
            isVisible={!isClosing}
            disableAnimation={!isClosing}
            placement="bottom-start"
            offset="1.5"
            overlay={
                <Box ref={useOutsidePress(onClose)} tabIndex={-1}>
                    {isClosing ? (
                        <ContentEditorGifPicker
                            onSelectGif={onSelectGif}
                            onClose={onClose}
                            platform="desktop"
                        />
                    ) : (
                        <FocusScope contain restoreFocus>
                            <ContentEditorGifPicker
                                onSelectGif={onSelectGif}
                                onClose={onClose}
                                platform="desktop"
                            />
                        </FocusScope>
                    )}
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={anchorPos}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorGifPickerMobileFloater({
    viewRef,
    onSelectGif,
    onClose,
}: {
    viewRef: RefObject<EditorView | null>;
    onSelectGif: (url: URL) => void;
    onClose: () => void;
}) {
    const handleClose = useCallback(() => {
        if (viewRef.current) {
            viewRef.current.dom.focus({preventScroll: true});
        }
        onClose();
    }, [viewRef, onClose]);

    return (
        <MobileFullScreenModal onClose={handleClose}>
            {() => (
                <ContentEditorGifPicker
                    onSelectGif={onSelectGif}
                    onClose={handleClose}
                    platform="mobile"
                />
            )}
        </MobileFullScreenModal>
    );
}
