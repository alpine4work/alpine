import {Node} from "prosemirror-model";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {AppContext} from "~/client/context/app_context.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {getContentReferencesFileSignedUrlExpirationTime} from "~/shared/content/content_references.js";
import {fileClassName} from "~/shared/content/content_styles.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {getFilePreviewImageResizeWidth} from "~/shared/files/get_file_preview_image_resize_width.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertSvgToCssDataUrl} from "~/shared/helpers/html/convert_svg_to_css_data_url.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {
    getFileSignedUrlFromAttachment,
    getFileWithoutSignedUrlFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";
import {falseStore, trueStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

let isContentFilePreviewSignedUrlRefreshDisabledForTest = false;

export function disableContentFilePreviewSignedUrlRefreshForTest() {
    assert(import.meta.jest);
    isContentFilePreviewSignedUrlRefreshDisabledForTest = true;
}

const contentFileSignedUrlEagerExpirationDurationMs = 1000 * 20;
const contentFileSignedUrlRefreshDurationMs =
    contentFileSignedUrlEagerExpirationDurationMs + 1000 * 20;

export class ContentFilePreviewExpirationTimers {
    private _isPaused = true;
    private readonly _storeByTime = new Map<
        number,
        {timeout: Timeout | null; readonly store: ValueStore<boolean>}
    >();

    public isPaused() {
        return this._isPaused;
    }

    /**
     * Pause all timers in this object. Any stores that are currently false
     * (e.g. `getExpiredTimerStore()`) won't be updated to true while this object
     * is paused since all timeouts have been cancelled. If you call `play()` all
     * timers will be re-scheduled.
     *
     * You should call this function when your component that renders file previews
     * unmounts in order to prevent memory leaks. Otherwise we'll keep accumulating
     * hour long timers that are never cancelled even if the user doesn't care
     * about them anymore.
     */
    public pause(): void {
        assert(!this._isPaused);
        this._isPaused = true;

        for (const entry of this._storeByTime.values()) {
            entry.timeout?.clear();
            entry.timeout = null;
        }
    }

    /**
     * Resume all paused timers in this object.
     *
     * If any timers should have been fired while the object was paused then we'll
     * fire those timers basically immediately after play has been called.
     *
     * This object starts in a paused state so you must call play to start
     * registering timers.
     */
    public play(): void {
        assert(this._isPaused);
        this._isPaused = false;

        for (const [time, entry] of this._storeByTime) {
            if (!entry.store.getSnapshot()) {
                entry.timeout ??= createTimeout(() => {
                    entry.store.finalSet(true);

                    // New signed URLs shouldn't have this expiration time. Delete from our map to
                    // prevent memory leaks.
                    this._storeByTime.delete(time);
                }, Math.max(0, time - Date.now()));
            }
        }
    }

    /**
     * Return a store which will switch to true ~20-30 seconds before the preview
     * URL actually expires. Generally returns return the same referentially equal
     * store for the same expiration time in the preview URL.
     */
    public getExpiredTimerStore(signedUrlSearch: string): Store<boolean> {
        // If we're on the server then always return false so we don't create
        // unnecessary timers on the server. This shouldn't realistically create issues
        // with SSR hydration since signed URLs should be generated at the start of an
        // SSR request and last much much longer (e.g. 1 hour) than an SSR request
        // should reasonably take (e.g. 1 second).
        if (typeof window === "undefined") return falseStore;

        const expirationTime = getContentReferencesFileSignedUrlExpirationTime(signedUrlSearch);

        // Round to the nearest 10 seconds so we end up creating fewer stores.
        const roundedExpirationTime = Math.floor(expirationTime / (1000 * 10)) * (1000 * 10);

        const eagerExpirationTime =
            roundedExpirationTime - contentFileSignedUrlEagerExpirationDurationMs;

        return this._getStore(eagerExpirationTime);
    }

    /**
     * Return a store which will switch to true ~40-50 seconds before the preview
     * URL expires. Generally returns the same referentially equal store for the
     * same expiration time in the preview URL.
     */
    public getRefreshTimerStore(signedUrlSearch: string): Store<boolean> {
        // If we're on the server then always return false so we don't create
        // unnecessary timers on the server. This shouldn't realistically create issues
        // with SSR hydration since signed URLs should be generated at the start of an
        // SSR request and last much much longer (e.g. 1 hour) than an SSR request
        // should reasonably take (e.g. 1 second).
        if (typeof window === "undefined") return falseStore;

        const expirationTime = getContentReferencesFileSignedUrlExpirationTime(signedUrlSearch);

        // Round to the nearest 10 seconds so we end up creating fewer stores.
        const roundedExpirationTime = Math.floor(expirationTime / (1000 * 10)) * (1000 * 10);

        const refreshTime = roundedExpirationTime - contentFileSignedUrlRefreshDurationMs;

        return this._getStore(refreshTime);
    }

    private _getStore(time: number) {
        // Make sure this isn't run on the server since we don't want to register a
        // bunch of unnecessary timeouts. The `getIsInitialAppRenderWithoutListening()`
        // check should handle this so this assertion is an extra precaution.
        assert(typeof window !== "undefined");

        const durationMsUntilTime = time - Date.now();
        if (durationMsUntilTime <= 0) return trueStore;

        return getOrSetDefaultMapValue(this._storeByTime, time, () => {
            const store = new ValueStore(false);

            const timeout = !this._isPaused
                ? createTimeout(() => {
                      store.finalSet(true);

                      // New signed URLs shouldn't have this expiration time. Delete from our map to
                      // prevent memory leaks.
                      this._storeByTime.delete(time);
                  }, durationMsUntilTime)
                : null;

            return {timeout, store};
        }).store;
    }
}

/**
 * Render the provided `file` node to an `HtmlElementGenerator`. This
 * `HtmlElementGenerator` can either be used to render `<ContentEditor>` or
 * `<ContentView>`.
 */
// TODO(calebmer, #files): Consider switching to a pure white background color
// so files on pure white look natural.
export function renderContentFilePreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        spaceId,
        node,
        reference,
        layout,
        expirationTimers,
    }: {
        spaceId: SpaceId;
        node: Node;
        reference: {signedUrlSearch: string; file: FileModel} | undefined;
        layout: ContentFileLayout;
        expirationTimers: ContentFilePreviewExpirationTimers;
    },
): HtmlElementGenerator {
    assert(node.type.name === "file");

    const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));

    assert(html instanceof HtmlElementGenerator);

    if (process.env.NODE_ENV !== "production" && reference) {
        html.setAttribute("data-testid", `ContentFile:${reference.file.contentType}`);
    }

    if (!reference) {
        // TODO(calebmer, #files): Implement
    } else if (!reference.file.preview) {
        // TODO(calebmer, #files): Implement
    } else {
        switch (reference.file.preview.type) {
            case "Audio": {
                // TODO(calebmer, #files): Implement
                break;
            }
            case "Code": {
                // TODO(calebmer, #files): Implement
                break;
            }
            case "Image": {
                if (
                    (!reference.file.preview.isProcessing && !reference.file.preview.ok) ||
                    reference.file.preview.placeholder === "Processing" ||
                    reference.file.preview.size === "Processing"
                ) {
                    // TODO(calebmer, #files): Implement
                    break;
                }

                const svg = renderFileImagePreviewPlaceholder(reference.file.preview.placeholder);

                html.setAttribute(
                    "style",
                    [
                        `background-image: ${convertSvgToCssDataUrl(svg)}`,
                        "background-position: center top",
                        "background-size: cover",
                    ].join("; "),
                );

                // Render the image if we have a signed preview URL and the signature isn't
                // expired.
                //
                // When the signature expires we re-render the file to remove the image from
                // the DOM. `addContentFilePreviewBehavior()` is responsible for fetching new
                // signatures that haven't expired.
                if (
                    reference &&
                    !get(expirationTimers.getExpiredTimerStore(reference.signedUrlSearch)) &&
                    reference.file.preview.content !== "Processing"
                ) {
                    const imageSourceBase = `/files/${spaceId}/${reference.file.id}${
                        reference.signedUrlSearch
                    }${reference.file.preview.content !== undefined ? "&variant=preview" : ""}`;

                    let image1xSource: string;
                    let image2xSource: string;
                    let image3xSource: string;

                    // Don't resize vector images. They're already infinitely resizable.
                    const isVectorImage =
                        (reference.file.preview.content?.contentType ??
                            reference.file.contentType) === "image/svg+xml";

                    if (isVectorImage) {
                        image1xSource = imageSourceBase;
                        image2xSource = imageSourceBase;
                        image3xSource = imageSourceBase;
                    } else {
                        const image1xWidth = getFilePreviewImageResizeWidth(layout.width);
                        const image2xWidth = getFilePreviewImageResizeWidth(layout.width * 2);
                        const image3xWidth = getFilePreviewImageResizeWidth(layout.width * 3);

                        // If we're outside the aspect ratio range then we always want to resize our
                        // file. Since resizing will also crop the file to our aspect ratio range. This
                        // will result in a smaller file to download.
                        const aspectRatio =
                            reference.file.preview.size.width / reference.file.preview.size.height;
                        const isOutsideAspectRatioRange =
                            aspectRatio < minFilePreviewAspectRatio ||
                            aspectRatio > maxFilePreviewAspectRatio;

                        if (!isOutsideAspectRatioRange) {
                            image1xSource =
                                reference.file.preview.size.width <= image1xWidth
                                    ? imageSourceBase
                                    : `${imageSourceBase}&width=${image1xWidth}`;

                            image2xSource =
                                reference.file.preview.size.width <= image2xWidth
                                    ? imageSourceBase
                                    : `${imageSourceBase}&width=${image2xWidth}`;

                            image3xSource =
                                reference.file.preview.size.width <= image3xWidth
                                    ? imageSourceBase
                                    : `${imageSourceBase}&width=${image3xWidth}`;
                        } else {
                            const defaultWidth = getFilePreviewImageResizeWidth(
                                reference.file.preview.size.width,
                            );

                            image1xSource =
                                reference.file.preview.size.width <= image1xWidth
                                    ? `${imageSourceBase}&width=${defaultWidth}`
                                    : `${imageSourceBase}&width=${image1xWidth}`;

                            image2xSource =
                                reference.file.preview.size.width <= image2xWidth
                                    ? `${imageSourceBase}&width=${defaultWidth}`
                                    : `${imageSourceBase}&width=${image2xWidth}`;

                            image3xSource =
                                reference.file.preview.size.width <= image3xWidth
                                    ? `${imageSourceBase}&width=${defaultWidth}`
                                    : `${imageSourceBase}&width=${image3xWidth}`;
                        }
                    }

                    const imageHtml = new HtmlElementGenerator("img");
                    imageHtml.setAttribute("class", sprinkles({width: "full", height: "full"}));
                    imageHtml.setAttribute(
                        "style",
                        "object-position: center top; object-fit: cover",
                    );

                    // Only load the image when it enters the viewport. For long documents with a
                    // lot of images this improves network utilization. This means our signed URL in
                    // `src` always needs to be up-to-date since we don't know when the browser will
                    // need it.
                    imageHtml.setAttribute("loading", "lazy");

                    imageHtml.setAttribute("src", image1xSource);

                    if (image1xSource === image2xSource) {
                        // We don't have any additional responsive image sources.
                    } else if (image2xSource === image3xSource) {
                        imageHtml.setAttribute("srcset", `${image1xSource}, ${image2xSource} 2x`);
                    } else {
                        imageHtml.setAttribute(
                            "srcset",
                            `${image1xSource}, ${image2xSource} 2x, ${image3xSource} 3x`,
                        );
                    }

                    html.appendChild(imageHtml);
                }

                if (typeof reference.file.preview.videoDuration === "number") {
                    // TODO(calebmer, #files): Implement
                }
                break;
            }
            default:
                throw exhaustive(reference.file.preview);
        }
    }

    return html;
}

// Round numbers to 3 decimal places so we sending less data over the
// network in our generated HTML.
function round6(n: number) {
    return Math.round(n * 10 ** 6) / 10 ** 6;
}

function renderFileImagePreviewPlaceholder(placeholder: FileImagePreviewPlaceholder) {
    const pixelGrid = placeholder.get();
    const pixelGridWidth = pixelGrid[0].length;
    const pixelGridHeight = pixelGrid.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixelGridWidth} ${pixelGridHeight}">`;

    const blurStdDeviation = 3 / 4;
    const translateX = -blurStdDeviation * 2;
    const translateY = -blurStdDeviation * 2;
    const scaleX = (pixelGridWidth + -translateX * 2) / pixelGridWidth;
    const scaleY = (pixelGridHeight + -translateY * 2) / pixelGridHeight;

    svg += `<filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="${round6(
        blurStdDeviation,
    )}" /></filter><g filter="url(#blur)">`;

    for (let y = 0; y < pixelGrid.length; y++) {
        const pixelRow = pixelGrid[y]!;

        for (let x = 0; x < pixelRow.length; x++) {
            const pixel = pixelRow[x]!;
            const color =
                "#" +
                pixel.r.toString(16).padStart(2, "0") +
                pixel.g.toString(16).padStart(2, "0") +
                pixel.b.toString(16).padStart(2, "0");

            svg +=
                `<rect ` +
                `x="${round6(x * scaleX + translateX)}" ` +
                `y="${round6(y * scaleY + translateY)}" ` +
                // Have `width` and `height` fill the remainder of the image so we don't get
                // any gaps between `<rect>`s from rounding errors when rendering the SVG.
                `width="${round6(scaleX)}" ` +
                `height="${round6(scaleY)}" ` +
                `fill="${color}"${
                    pixel.alpha !== undefined ? ` fill-opacity="${pixel.alpha}"` : ""
                } />`;
        }
    }

    svg += "</g></svg>";
    return svg;
}

export function addContentFilePreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {
        spaceId,
        reference,
        attachmentTarget,
        expirationTimers,
        isOurEditorUploading,
        onUpdate,
        onSignedUrlRefresh,
        onShiftMouseDown,
        onLongPress,
    }: {
        spaceId: SpaceId;
        node: Node;
        reference: {signedUrlSearch: string; file: FileModel} | undefined;
        attachmentTarget: FileAttachmentTarget;
        expirationTimers: ContentFilePreviewExpirationTimers;
        isOurEditorUploading: ((fileId: FileId) => boolean) | false;
        onUpdate: (file: FileModel, signedUrlSearch: string) => void;
        onSignedUrlRefresh: (fileId: FileId, signedUrlSearch: string) => void;
        onShiftMouseDown?: (event: PointerEvent) => void;
        onLongPress?: () => void;
    },
): () => void {
    assert(element.classList.contains(fileClassName));

    // Make sure `play()` was called on the expiration timers object.
    assert(!expirationTimers.isPaused());

    let pollTimeout: Timeout | null = null;
    let unsubscribeFromRefreshTimer: (() => void) | null = null;

    /* ========================================================================== *\
     *                             Poll loading file                              *
    \* ========================================================================== */

    if (reference?.file && reference.file.isLoading()) {
        let pollCount = 0;
        let pollErrorCount = 0;

        const schedulePoll = () => {
            assert(pollTimeout === null);

            // Increase the poll duration exponentially until we're polling every ~5s.
            pollTimeout = createTimeout(poll, 500 + 2 ** Math.min(pollCount, 12));
        };

        const poll = () => {
            pollTimeout = null;
            pollCount++;

            // Don't poll if our editor is the one uploading the file. Then we'll have a
            // connection to `FileUploadService` which will push update events as different
            // parts of the file finish uploading. We still want the poll timers to run so
            // that if our editor stops uploading the file (e.g. if the HTTP request times
            // out) then polling will kick in to update the file.
            if (isOurEditorUploading !== false && isOurEditorUploading(reference.file.id)) {
                schedulePoll();
                return;
            }

            getFileWithoutSignedUrlFromAttachment(getContext(), {
                spaceId,
                fileId: reference.file.id,
                target: attachmentTarget,
            }).then(
                ({file: newFile}) => {
                    onUpdate(newFile, reference.signedUrlSearch);

                    if (newFile.isLoading()) {
                        schedulePoll();
                    }
                },
                error => {
                    pollErrorCount++;

                    if (pollErrorCount < 3) {
                        schedulePoll();
                    } else {
                        getContext()
                            .tracer.getRoot()
                            .logUncaughtException(
                                "Polling for file that hasn't finished loading failed",
                                error,
                            );
                    }
                },
            );
        };

        schedulePoll();
    }

    /* ========================================================================== *\
     *                             Refresh signed URL                             *
    \* ========================================================================== */

    if (!isContentFilePreviewSignedUrlRefreshDisabledForTest && reference) {
        const refreshTimerStore = expirationTimers.getRefreshTimerStore(reference.signedUrlSearch);

        const refresh = () => {
            getFileSignedUrlFromAttachment(getContext(), {
                spaceId,
                fileId: reference.file.id,
                target: attachmentTarget,
            }).then(
                output => {
                    onSignedUrlRefresh(reference.file.id, output.signedUrlSearch);
                },
                error => {
                    // TODO(calebmer, #files): Should we present this error to the user somehow?
                    // Perhaps by switching to an error rendering for the file.
                    getContext()
                        .tracer.getRoot()
                        .logUncaughtException(
                            "Couldn't refresh expired file preview URL signature",
                            error,
                        );
                },
            );
        };

        if (refreshTimerStore.getSnapshot()) {
            refresh();
        } else {
            unsubscribeFromRefreshTimer = refreshTimerStore.subscribe(() => {
                if (!refreshTimerStore.getSnapshot()) return;

                unsubscribeFromRefreshTimer?.();
                unsubscribeFromRefreshTimer = null;

                refresh();
            });
        }
    }

    /* ========================================================================== *\
     *                                Press event                                 *
    \* ========================================================================== */

    let isPointerDownAndOver = false;
    let longPressTimeout: Timeout | null = null;

    const handlePointerDown = (event: PointerEvent) => {
        isPointerDownAndOver = event.button === 0 && !isModifiedPointerEvent(event);

        if (isPointerDownAndOver) {
            // Normally ProseMirror sets `element.draggable = true` on node selection
            // ([source][1]). But since we don't select our node until after a long press
            // let's start our `pointerdown` event by setting `element.draggable = true`.
            //
            // [1]: https://github.com/ProseMirror/prosemirror-view/blob/17b508f618c944c54776f8ddac45edcb49970796/src/viewdesc.ts#L838-L850
            element.draggable = true;

            element.classList.add(contentStyles.pressedFileClassName);
        } else {
            element.classList.remove(contentStyles.pressedFileClassName);
        }
        element.classList.remove(contentStyles.longPressedFileClassName);

        longPressTimeout?.clear();
        longPressTimeout = null;

        // If the mouse performs a shift or alt click then we select the node instead
        // of opening the file viewer. This interaction is not obvious. You can also
        // use keyboard shortcuts or right click to select a file. The user should be
        // able to figure out one of these three methods.
        if (event.pointerType === "mouse" && (event.altKey || event.shiftKey)) {
            onShiftMouseDown?.(event);
        } else if (isPointerDownAndOver && onLongPress) {
            // Emulate a `UILongPressGestureRecognizer` on iOS. Which [waits for a touch to
            // last 0.5 seconds][1] before firing.
            //
            // [1]: https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            longPressTimeout = createTimeout(() => {
                longPressTimeout = null;
                onLongPress();
            }, 500);
        }
    };

    const resetPointerState = () => {
        isPointerDownAndOver = false;

        // We set `element.draggable = true` on `pointerdown` and ProseMirror sets
        // `element.draggable = true` on node selection ([source][1]). So if the node
        // is selected, let ProseMirror set `element.draggable = false` instead of us.
        //
        // [1]: https://github.com/ProseMirror/prosemirror-view/blob/17b508f618c944c54776f8ddac45edcb49970796/src/viewdesc.ts#L838-L850
        if (!element.classList.contains("ProseMirror-selectednode")) element.draggable = false;

        element.classList.remove(contentStyles.pressedFileClassName);
        element.classList.remove(contentStyles.longPressedFileClassName);

        longPressTimeout?.clear();
        longPressTimeout = null;
    };

    const handlePointerUp = resetPointerState;
    const handlePointerLeave = resetPointerState;
    const handlePointerCancel = resetPointerState;
    const handleDragStart = resetPointerState;
    const handleParentScrollWhenPointerDownAndOver = resetPointerState;

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointerleave", handlePointerLeave);
    element.addEventListener("pointercancel", handlePointerCancel);
    element.addEventListener("dragstart", handleDragStart);
    addParentScrollWhenPointerDownAndOverListener(
        element,
        handleParentScrollWhenPointerDownAndOver,
    );

    return () => {
        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointerleave", handlePointerLeave);
        element.removeEventListener("pointercancel", handlePointerCancel);
        element.removeEventListener("dragstart", handleDragStart);
        removeParentScrollWhenPointerDownAndOverListener(
            element,
            handleParentScrollWhenPointerDownAndOver,
        );

        resetPointerState();

        pollTimeout?.clear();
        pollTimeout = null;

        unsubscribeFromRefreshTimer?.();
        unsubscribeFromRefreshTimer = null;
    };
}
