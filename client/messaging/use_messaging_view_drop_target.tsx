import {HTMLAttributes, useState} from "react";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {MessagingViewDragOverlay} from "~/client/messaging/internal/messaging_view_drag_overlay.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {fileClassName} from "~/shared/content/content_styles.js";
import {canonicalizeFileContentTypeIfExists} from "~/shared/files/file_content_type.js";

/**
 * Encapsulates the logic for turning a `<MessagingView>` into a drop target.
 * Add `dropTargetProps` to the element you want to make droppable and render
 * `dragOverlay` as a child of that element (the element should also have
 * `position: relative` for `dragOverlay` to be positioned properly).
 */
export function useMessagingViewDropTarget<RoomKey extends string>({
    messageEditing,
    getInputRef,
}: {
    messageEditing: MessageEditing<RoomKey>;
    getInputRef: (coords: {x: number; y: number}) => MessageInputRef | null;
}) {
    const [dragEnterState, setDragEnterState] = useState<{
        count: number;
        hasNonTextType: boolean;
    } | null>(null);

    const [isDraggingFileWithin, setIsDraggingFileWithin] = useState(false);

    const [waitingForDrop, setWaitingForDrop] = useState<symbol | null>(null);
    if (dragEnterState && waitingForDrop) setWaitingForDrop(null);

    // Continue showing the drag overlay for the loading indicator delay (currently
    // 500ms). That way if the drop is fast the UI doesn't flash the drop indicator
    // off before adding files.
    const withDelayedDragOverlay =
        !useDelayLoadingIndicator(waitingForDrop !== null) && waitingForDrop !== null;

    const dragOverlay = ((!isDraggingFileWithin &&
        !messageEditing.state.isEditing &&
        dragEnterState?.hasNonTextType) ||
        withDelayedDragOverlay) && <MessagingViewDragOverlay />;

    const dropTargetProps: HTMLAttributes<HTMLElement> = {
        onDragStartCapture: event => {
            // We don't want dragging a file inside our messaging view to count as the user
            // trying to drop the file back in the messaging view.
            if (event.target instanceof HTMLElement && event.target.closest(`.${fileClassName}`)) {
                setIsDraggingFileWithin(true);
            }
        },
        onDragEndCapture: () => {
            setIsDraggingFileWithin(false);
        },
        onDragEnter: event => {
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
            event.preventDefault();
        },
        onDrop: event => {
            event.preventDefault();
            setDragEnterState(null);

            if (
                !isDraggingFileWithin &&
                !messageEditing.state.isEditing &&
                dragEnterState?.hasNonTextType
            ) {
                const inputRef = getInputRef({x: event.clientX, y: event.clientY});

                if (inputRef !== null) {
                    const waitingForDrop = Symbol();
                    setWaitingForDrop(waitingForDrop);

                    inputRef.drop(event.dataTransfer).finally(() => {
                        // Handle race conditions by only resetting to null if the symbol from this
                        // callback is present in state.
                        setWaitingForDrop(lastWaitingForDrop => {
                            if (lastWaitingForDrop !== waitingForDrop) return lastWaitingForDrop;
                            return null;
                        });
                    });
                }
            }
        },
    };

    return {dragOverlay, dropTargetProps};
}
