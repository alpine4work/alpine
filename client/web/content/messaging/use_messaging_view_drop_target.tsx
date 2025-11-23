import {DragEvent, HTMLAttributes, useState} from "react";
import {MessagingViewDragOverlay} from "~/client/web/content/messaging/internal/messaging_view_drag_overlay.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {fileClassName} from "~/shared/design/core/constant_class_names.js";
import {canonicalizeFileContentTypeIfExists} from "~/shared/files/file_content_type.js";

/**
 * Encapsulates the logic for turning a `<MessagingView>` into a drop target.
 * Add `dropTargetProps` to the element you want to make droppable and render
 * `dragOverlay` as a child of that element (the element should also have
 * `position: relative` for `dragOverlay` to be positioned properly).
 */
export function useMessagingViewDropTarget({
    isDisabled,
    onDrop,
}: {
    isDisabled: boolean;
    onDrop: (event: DragEvent) => {finally(listener: () => void): void} | null;
}) {
    const [dragEnterState, setDragEnterState] = useState<{
        count: number;
        hasNonTextType: boolean;
    } | null>(null);
    if (isDisabled && dragEnterState) setDragEnterState(null);

    const [isDraggingFileWithin, setIsDraggingFileWithin] = useState(false);
    if (isDisabled && isDraggingFileWithin) setIsDraggingFileWithin(false);

    const [waitingForDrop, setWaitingForDrop] = useState<symbol | null>(null);
    if (dragEnterState && waitingForDrop) setWaitingForDrop(null);

    // Continue showing the drag overlay for the loading indicator delay (currently
    // 500ms). That way if the drop is fast the UI doesn't flash the drop indicator
    // off before adding files.
    const withDelayedDragOverlay =
        !useDelayLoadingIndicator(waitingForDrop !== null) && waitingForDrop !== null;

    const dragOverlay =
        !isDisabled &&
        ((!isDraggingFileWithin && dragEnterState?.hasNonTextType) || withDelayedDragOverlay) ? (
            <MessagingViewDragOverlay />
        ) : null;

    let dropTargetProps: Pick<
        HTMLAttributes<HTMLElement>,
        | "onDragStartCapture"
        | "onDragEndCapture"
        | "onDragEnter"
        | "onDragLeave"
        | "onDragOver"
        | "onDrop"
    > | null;
    if (isDisabled) {
        // Don't allocate an object if this hook is disabled.
        dropTargetProps = null;
    } else {
        dropTargetProps = {
            onDragStartCapture: event => {
                if (isDisabled) return;

                // We don't want dragging a file inside our messaging view to count as the user
                // trying to drop the file back in the messaging view.
                if (
                    event.target instanceof HTMLElement &&
                    event.target.closest(`.${fileClassName}`)
                ) {
                    setIsDraggingFileWithin(true);
                }
            },
            onDragEndCapture: () => {
                if (isDisabled) return;
                setIsDraggingFileWithin(false);
            },
            onDragEnter: event => {
                if (isDisabled) return;

                // If this drag only has `text/plain` and `text/html` it's probably because the
                // user is dragging some content from either their browser or another app. If
                // the user is dragging text, we want to let the message input's
                // `<ContentEditor>` handle dropped text.
                const hasNonTextType = event.dataTransfer.types.some(type => {
                    if (type === "Files") return true;
                    const canonicalType = canonicalizeFileContentTypeIfExists(type);
                    return canonicalType !== "text/plain" && canonicalType !== "text/html";
                });

                setDragEnterState(dragState => {
                    if (dragState) return {...dragState, count: dragState.count + 1};
                    return {count: 1, hasNonTextType};
                });
            },
            onDragLeave: () => {
                if (isDisabled) return;

                // [Safari doesn't set `event.relatedTarget`][1] whereas Chrome does. If we
                // reliably had access to `event.relatedTarget` we'd check:
                // `event.currentTarget.contains(event.relatedTarget)` to know whether we need
                // to reset our drag state.
                //
                // Instead we look at `dragenter` event counts. Once we reach 0 that means the
                // user has fully dragged out of the container. We got the idea for this fix
                // from [this Gist][2].
                //
                // We use this method in Chrome as well (even though we could use
                // `event.relatedTarget`) to have consistent behavior across all browsers.
                //
                // [1]: https://bugs.webkit.org/show_bug.cgi?id=66547
                // [2]: https://gist.github.com/alexreardon/10c595cbb840608a2828db56df99fa79
                setDragEnterState(dragState => {
                    if (!dragState) return dragState;
                    if (dragState.count <= 1) return null;
                    return {...dragState, count: dragState.count - 1};
                });
            },
            onDragOver: event => {
                if (isDisabled) return;
                event.preventDefault();
            },
            onDrop: event => {
                if (isDisabled) return;

                event.preventDefault();
                setDragEnterState(null);

                if (!isDraggingFileWithin && dragEnterState?.hasNonTextType) {
                    const promise = onDrop(event);

                    if (promise !== null) {
                        const waitingForDrop = Symbol();
                        setWaitingForDrop(waitingForDrop);

                        promise.finally(() => {
                            // Handle race conditions by only resetting to null if the symbol from this
                            // callback is present in state.
                            setWaitingForDrop(lastWaitingForDrop => {
                                if (lastWaitingForDrop !== waitingForDrop)
                                    return lastWaitingForDrop;
                                return null;
                            });
                        });
                    }
                }
            },
        };
    }

    return {dragOverlay, dropTargetProps};
}
