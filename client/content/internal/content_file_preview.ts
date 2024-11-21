import classNames from "classnames";
import Color from "color";
import prettyBytes from "pretty-bytes";
import {Node} from "prosemirror-model";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {
    addContentFileAudioPlayerBehavior,
    renderContentFileAudioPlayer,
} from "~/client/content/internal/content_file_audio_player.js";
import {
    ContentFileLayout,
    getFilePreviewSize,
} from "~/client/content/internal/content_file_layout_computations.js";
import {ContentFilePollerContext} from "~/client/content/internal/content_file_poller.js";
import {ContentFilePreviewExpirationTimers} from "~/client/content/internal/content_file_preview_expiration_timers.js";
import {ContentFileProcessorError} from "~/client/content/internal/content_file_processor_error.js";
import {
    addContentFileVideoPlayerBehavior,
    renderContentFileVideoPlayer,
} from "~/client/content/internal/content_file_video_player.js";
import {handoffContentFilePreviewState} from "~/client/content/internal/handoff_content_file_preview_state.js";
import {transparentImageDataUrl} from "~/client/content/internal/helpers/transparent_image_data_url.js";
import {getContentFileViewerSrc} from "~/client/content/internal/load_content_file_viewer_data.js";
import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {AppContext} from "~/client/context/app_context.js";
import {addContextMenuActions} from "~/client/design/context_menu.js";
import {Reporter} from "~/client/design/reporter.js";
import {isHtmlImageElementLoadedAndDecoded} from "~/client/helpers/elements/is_html_image_element_loaded_and_decoded.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {getGlobalContext} from "~/client/helpers/global_context.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {fileDottedSvg} from "~/client/icons/file_dotted_svg.js";
import {lockIconSvg} from "~/client/icons/lock_icon_svg.js";
import {spinnerGapIconSvg} from "~/client/icons/spinner_gap_svg.js";
import {warningIconSvg} from "~/client/icons/warning_icon_svg.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {NavigateFunction} from "~/client/remix/use_navigate.js";
import {
    colorSchemeVars,
    contentFileAudioPlayerStyles,
    contentFileVideoAndAudioPlayerControlsStyles,
    contentFileVideoPlayerStyles,
    contentStyles,
    greyElevated2ClassName,
    pulseAnimationClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {
    codeBlockClassName,
    codeBlockLineClassName,
    codeBlockLineContentClassName,
    codeBlockWrapperClassName,
    fileClassName,
} from "~/shared/content/content_styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {ColorWithShade} from "~/shared/design/core/inverted_colors.js";
import {Platform} from "~/shared/design/core/platform.js";
import {screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {
    FileImagePreviewPlaceholder,
    fileImagePreviewPlaceholderBaseSize,
} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    FileCodePreview,
    FileImagePreview,
    FileImagePreviewSize,
} from "~/shared/files/file_preview.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {getFilePreviewImageResizeWidth} from "~/shared/files/get_file_preview_image_resize_width.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";
import {
    HtmlElementGenerator,
    HtmlGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {getFileSignedUrlFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";
import {Store} from "~/shared/store/store.js";

let isContentFilePreviewSignedUrlRefreshDisabledForTest = false;

export function disableContentFilePreviewSignedUrlRefreshForTest() {
    assert(import.meta.jest);
    isContentFilePreviewSignedUrlRefreshDisabledForTest = true;
}

/**
 * Render the provided `file` node to an `HtmlElementGenerator`. This
 * `HtmlElementGenerator` can either be used to render `<ContentEditor>` or
 * `<ContentView>`.
 *
 * IMPORTANT: If you make a change to preview rendering here you should also
 * consider making the same change to `<ContentFileViewerModalDesktop>` and
 * `<ContentFileViewerModalMobile>`. We have three renderers for every file
 * type. The inline preview, the fullscreen desktop modal, and the fullscreen
 * mobile modal. They should all look and behave about the same.
 */
export function renderContentFilePreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        spaceId,
        node,
        reference,
        layout,
        screenWidth,
        platform,
        spacingScale,
        isInitialAppRender,
        withoutInteractivity = false,
        expirationTimers,
    }: {
        spaceId: SpaceId;
        node: Node;
        reference: {signedUrlSearch: string; file: FileModel} | undefined;
        layout: ContentFileLayout;
        screenWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
        withoutInteractivity?: boolean;
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
        const blankHtml = new HtmlElementGenerator("div");
        html.appendChild(blankHtml);

        blankHtml.setAttribute(
            "class",
            sprinkles({
                position: "absolute",
                inset: "0",
                backgroundColor: "grey-0",
            }),
        );

        appendImageHtmlForSelection(blankHtml, platform);
    } else if (!reference.file.preview) {
        const containerHtml = new HtmlElementGenerator("div");
        html.appendChild(containerHtml);

        containerHtml.setAttribute(
            "class",
            sprinkles({
                position: "absolute",
                inset: "0",
                backgroundColor: "grey-0",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: "grey-40",
            }),
        );

        const unknownHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(unknownHtml);

        unknownHtml.setAttribute(
            "class",
            sprinkles({
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1.5",
                fontSize: layout.width < 150 ? "25" : "50",
                // Push the loading spinner into the center with some
                // padding top.
                paddingTop: "2",
            }),
        );

        unknownHtml.appendChild(
            createSvgHtmlGenerator(
                fileDottedSvg({
                    weight: "light",
                    className: sprinkles({
                        color: "grey-30",
                        width: "7",
                        height: "7",
                    }),
                }),
            ),
        );
        const unknownLabelHtml = new HtmlElementGenerator("div");
        unknownHtml.appendChild(unknownLabelHtml);
        unknownLabelHtml.setAttribute("class", sprinkles({textAlign: "center"}));
        unknownLabelHtml.appendChild(new HtmlTextGenerator("Unknown"));
        unknownLabelHtml.appendChild(new HtmlElementGenerator("br"));
        unknownLabelHtml.appendChild(
            new HtmlTextGenerator(prettyBytes(reference.file.contentLength)),
        );

        appendImageHtmlForSelection(containerHtml, platform);
    } else {
        switch (reference.file.preview.type) {
            case "Image": {
                renderContentFileImagePreview(get, html, {
                    spaceId,
                    signedUrlSearch: reference.signedUrlSearch,
                    file: reference.file,
                    filePreview: reference.file.preview,
                    layout,
                    platform,
                    isInitialAppRender,
                    withoutInteractivity,
                    expirationTimers,
                });
                break;
            }
            case "Audio": {
                const audioSrc = getContentFileViewerSrc({
                    spaceId,
                    signedUrlSearch: reference.signedUrlSearch,
                    file: reference.file,
                });

                if (reference.file.preview.isProcessing || audioSrc === null) {
                    renderContentFileProcessingPreview(html, {file: reference.file, layout});
                } else if (!reference.file.preview.ok) {
                    renderContentFileProcessorErrorPreview(html, {
                        contentType: reference.file.contentType,
                        error: reference.file.preview.error,
                        layout,
                    });
                } else {
                    const containerHtml = new HtmlElementGenerator("div");
                    html.appendChild(containerHtml);
                    containerHtml.setAttribute(
                        "class",
                        classNames(
                            contentFileAudioPlayerStyles.containerClassName,
                            contentFileVideoAndAudioPlayerControlsStyles.containerClassName,
                        ),
                    );

                    renderContentFileAudioPlayer(containerHtml, {
                        file: reference.file,
                        filePreview: reference.file.preview,
                        audioSrc,
                        platform,
                        isInitialAppRender,
                        withoutInteractivity,
                        layout,
                    });
                }

                appendImageHtmlForSelection(html, platform);
                break;
            }
            case "Code": {
                renderContentFileCodePreview(html, {
                    file: reference.file,
                    filePreview: reference.file.preview,
                    layout,
                    screenWidth,
                    platform,
                    spacingScale,
                });
                break;
            }
            default:
                throw exhaustive(reference.file.preview);
        }
    }

    return html;
}

/**
 * We add a transparent, invisible, image with `user-select: text` so that the
 * browser renders a selection highlight over the image when it's selected.
 * Since browsers like Chrome will render selection highlights over images.
 *
 * We don't add this image on mobile since Safari does weird things with a
 * selectable image in `contenteditable="true"`. This is consistent with our
 * `user-select` style for `fileImagePreviewContentClassName`.
 */
function appendImageHtmlForSelection(containerHtml: HtmlElementGenerator, platform: Platform) {
    if (platform === "mobile") return;

    const imageHtmlForSelection = new HtmlElementGenerator("img");
    containerHtml.appendChild(imageHtmlForSelection);
    imageHtmlForSelection.setAttribute("aria-hidden", "true");
    imageHtmlForSelection.setAttribute("src", transparentImageDataUrl);
    imageHtmlForSelection.setAttribute("class", contentStyles.fileBlankImageForSelectionClassName);
}

function renderContentFileProcessingPreview(
    html: HtmlElementGenerator,
    {
        file,
        layout,
    }: {
        file: FileModel;
        layout: {width: number; height: number};
    },
) {
    const containerHtml = new HtmlElementGenerator("div");
    html.appendChild(containerHtml);

    containerHtml.setAttribute(
        "class",
        sprinkles({
            position: "absolute",
            inset: "0",
            backgroundColor: "grey-0",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            color: "grey-40",
        }),
    );

    const placeholder = generateFileProcessingPreviewPlaceholder(file);
    const svg = renderFileProcessingPreviewPlaceholder(placeholder, {
        className: classNames(
            pulseAnimationClassName,
            sprinkles({
                zIndex: "10",
                position: "absolute",
                inset: "0",
                width: "full",
                height: "full",
            }),
        ),
    });

    containerHtml.appendChild(createSvgHtmlGenerator(svg));

    const processingHtml = new HtmlElementGenerator("div");
    containerHtml.appendChild(processingHtml);

    processingHtml.setAttribute(
        "class",
        sprinkles({
            zIndex: "20",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.5",
            fontSize: layout.width < 150 ? "25" : "50",
            // Push the loading spinner into the center with some
            // padding top.
            paddingTop: "4",
        }),
    );

    processingHtml.appendChild(
        createSvgHtmlGenerator(
            spinnerGapIconSvg({
                className: `${spinAnimationClassName} ${sprinkles({
                    width: "6",
                    height: "6",
                })}`,
            }),
        ),
    );
    processingHtml.appendChild(
        new HtmlTextGenerator(`Processing ${getFileContentTypeNoun(file.contentType)}`),
    );
}

function renderContentFileProcessorErrorPreview(
    html: HtmlElementGenerator,
    {
        contentType,
        error,
        layout,
    }: {
        contentType: FileContentType;
        error: FileProcessorError;
        layout: {width: number; height: number};
    },
) {
    const containerHtml = new HtmlElementGenerator("div");
    html.appendChild(containerHtml);

    containerHtml.setAttribute(
        "class",
        sprinkles({
            position: "absolute",
            inset: "0",
            backgroundColor: "grey-0",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
        }),
    );

    // Width at which we need to shrinking the error message so that it's still
    // readable.
    const minWidth = 250;

    const errorHtml = new HtmlElementGenerator("div");
    containerHtml.appendChild(errorHtml);

    errorHtml.setAttribute(
        "style",
        `min-width: ${minWidth}px; transform: scale(${Math.min(1, layout.width / minWidth)})`,
    );

    errorHtml.setAttribute(
        "class",
        sprinkles({
            zIndex: "20",
            position: "relative",
            maxWidth: "64",
            paddingX: "8",
            paddingTop: "5",
            paddingBottom: "4",
            display: "flex",
            flexDirection: "column",
            gap: "1.5",
        }),
    );

    const errorTitleHtml = new HtmlElementGenerator("div");
    errorHtml.appendChild(errorTitleHtml);

    errorTitleHtml.setAttribute(
        "class",
        sprinkles({
            display: "flex",
            alignItems: "center",
            gap: "1.5",
            fontSize: "200",
            fontStyle: "semi-bold",
            color: "grey-70",
        }),
    );

    const {title, displayMessage} = new ContentFileProcessorError(contentType, error);

    switch (error.type) {
        case "Unknown": {
            errorTitleHtml.appendChild(
                createSvgHtmlGenerator(
                    warningIconSvg({
                        weight: "bold",
                        className: sprinkles({
                            width: "4",
                            height: "4",
                        }),
                    }),
                ),
            );
            break;
        }
        case "PasswordProtected": {
            errorTitleHtml.appendChild(
                createSvgHtmlGenerator(
                    lockIconSvg({
                        weight: "bold",
                        className: sprinkles({
                            width: "4",
                            height: "4",
                        }),
                    }),
                ),
            );
            break;
        }
        default:
            throw exhaustive(error);
    }

    errorTitleHtml.appendChild(new HtmlElementGenerator(title));

    const errorMessageHtml = new HtmlElementGenerator("div");
    errorHtml.appendChild(errorMessageHtml);

    errorMessageHtml.setAttribute(
        "class",
        sprinkles({
            fontSize: "75",
            color: "grey-50",
        }),
    );

    for (const displayMessageSegment of displayMessage) {
        switch (displayMessageSegment.type) {
            case "Text":
            case "SensitiveText": {
                errorMessageHtml.appendChild(new HtmlTextGenerator(displayMessageSegment.text));
                break;
            }
            case "Link": {
                // We don't currently support links in content file previews. Since we can't
                // render a full `<Link>` component (like we do in
                // `<ErrorDisplayMessageRenderer>`) with all the navigation bells and whistles.
                errorMessageHtml.appendChild(new HtmlTextGenerator(displayMessageSegment.text));
                break;
            }
            default:
                throw exhaustive(displayMessageSegment);
        }
    }
}

function renderContentFileImagePreview(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        spaceId,
        signedUrlSearch,
        file,
        filePreview,
        layout,
        platform,
        isInitialAppRender,
        withoutInteractivity,
        expirationTimers,
    }: {
        spaceId: SpaceId;
        signedUrlSearch: string;
        file: FileModel;
        filePreview: FileImagePreview;
        layout: ContentFileLayout;
        platform: Platform;
        isInitialAppRender: boolean;
        withoutInteractivity: boolean;
        expirationTimers: ContentFilePreviewExpirationTimers;
    },
) {
    if (
        (!filePreview.isProcessing && !filePreview.ok) ||
        filePreview.placeholder === "Processing" ||
        filePreview.size === "Processing"
    ) {
        if (filePreview.isProcessing || filePreview.ok) {
            renderContentFileProcessingPreview(html, {file, layout});
        } else {
            renderContentFileProcessorErrorPreview(html, {
                contentType: file.contentType,
                error: filePreview.error,
                layout,
            });
        }
        return;
    }

    // This is the file size after applying scaling. If you want the actual pixel
    // size of the file use `reference.file.preview.size`.
    const fileSize = getFilePreviewSize(file);

    renderContentFileImagePreviewInner(get, html, {
        spaceId,
        signedUrlSearch,
        file,
        fileSize,
        filePreview,
        filePreviewSize: filePreview.size,
        filePreviewPlaceholder: filePreview.placeholder,
        layout,
        platform,
        isInitialAppRender,
        withoutInteractivity,
        expirationTimers,
    });
}

function renderContentFileImagePreviewInner(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        spaceId,
        signedUrlSearch,
        file,
        fileSize,
        filePreview,
        filePreviewSize,
        filePreviewPlaceholder,
        layout,
        platform,
        isInitialAppRender,
        withoutInteractivity,
        expirationTimers,
    }: {
        spaceId: SpaceId;
        signedUrlSearch: string;
        file: FileModel;
        fileSize: {width: number; height: number};
        filePreview: Exclude<FileImagePreview, {ok: false}>;
        filePreviewSize: FileImagePreviewSize;
        filePreviewPlaceholder: FileImagePreviewPlaceholder;
        layout: ContentFileLayout;
        platform: Platform;
        isInitialAppRender: boolean;
        withoutInteractivity: boolean;
        expirationTimers: ContentFilePreviewExpirationTimers;
    },
) {
    const adjustments = getFileImagePreviewRenderingAdjustments(filePreviewPlaceholder);

    if (
        adjustments.isNearWhite ||
        adjustments.isNearBlack ||
        adjustments.hasTransparentBackground
    ) {
        html.setAttribute(
            "class",
            classNames(
                html.getAttribute("class"),
                adjustments.isNearWhite && contentStyles.fileNearWhiteClassName,
                adjustments.isNearBlack && contentStyles.fileNearBlackClassName,
                adjustments.hasTransparentBackground &&
                    contentStyles.fileTransparentBackgroundClassName,
            ),
        );
    }

    const svg = renderFileImagePreviewPlaceholder(filePreviewPlaceholder);

    const placeholderImageHtml = new HtmlElementGenerator("img");
    placeholderImageHtml.setAttribute("class", contentStyles.fileImagePreviewPlaceholderClassName);
    placeholderImageHtml.setAttribute(
        "style",
        `max-width: ${fileSize.width}px; max-height: ${fileSize.height}px`,
    );
    // The placeholder image is purely decorative. It shouldn't be visible to
    // assistive technologies.
    placeholderImageHtml.setAttribute("aria-hidden", "true");
    placeholderImageHtml.setAttribute("src", convertSvgToDataUrl(svg));

    html.appendChild(placeholderImageHtml);

    // Render the image if we have a signed preview URL and the signature isn't
    // expired.
    //
    // When the signature expires we re-render the file to remove the image from
    // the DOM. `addContentFilePreviewBehavior()` is responsible for fetching new
    // signatures that haven't expired.
    if (
        !get(expirationTimers.getExpiredTimerStore(signedUrlSearch)) &&
        filePreview.content !== "Processing"
    ) {
        const imageSourceBase = `/files/${spaceId}/${file.id}${signedUrlSearch}${
            filePreview.content !== undefined ? "&variant=preview" : ""
        }`;

        let image1xSource: string;
        let image2xSource: string;
        let image3xSource: string;

        // Don't resize vector images. They're already infinitely resizable.
        const isVectorImage =
            (filePreview.content?.contentType ?? file.contentType) === "image/svg+xml";

        if (isVectorImage) {
            image1xSource = imageSourceBase;
            image2xSource = imageSourceBase;
            image3xSource = imageSourceBase;
        } else {
            const image1xWidth = getFilePreviewImageResizeWidth(layout.width);
            const image2xWidth = getFilePreviewImageResizeWidth(layout.width * 2);
            const image3xWidth = getFilePreviewImageResizeWidth(layout.width * 3);

            const aspectRatio = filePreviewSize.width / filePreviewSize.height;
            const isOutsideAspectRatioRange =
                aspectRatio < minFilePreviewAspectRatio || aspectRatio > maxFilePreviewAspectRatio;

            if (!isOutsideAspectRatioRange) {
                // If the file is smaller than our desired resize width then don't bother
                // resizing since resizing will be a noop.
                image1xSource =
                    filePreviewSize.width <= image1xWidth
                        ? imageSourceBase
                        : `${imageSourceBase}&width=${image1xWidth}`;

                image2xSource =
                    filePreviewSize.width <= image2xWidth
                        ? imageSourceBase
                        : `${imageSourceBase}&width=${image2xWidth}`;

                image3xSource =
                    filePreviewSize.width <= image3xWidth
                        ? imageSourceBase
                        : `${imageSourceBase}&width=${image3xWidth}`;
            }

            // If we're outside the aspect ratio range then we always want to resize our
            // file. Since resizing will also crop the file to our aspect ratio range. This
            // will result in a smaller file to download.
            else {
                const defaultWidth = getFilePreviewImageResizeWidth(filePreviewSize.width);

                image1xSource =
                    filePreviewSize.width <= image1xWidth
                        ? `${imageSourceBase}&width=${defaultWidth}`
                        : `${imageSourceBase}&width=${image1xWidth}`;

                image2xSource =
                    filePreviewSize.width <= image2xWidth
                        ? `${imageSourceBase}&width=${defaultWidth}`
                        : `${imageSourceBase}&width=${image2xWidth}`;

                image3xSource =
                    filePreviewSize.width <= image3xWidth
                        ? `${imageSourceBase}&width=${defaultWidth}`
                        : `${imageSourceBase}&width=${image3xWidth}`;
            }
        }

        let imageSrcset: string;
        if (image1xSource === image2xSource) {
            imageSrcset = image1xSource;
        } else if (image2xSource === image3xSource) {
            imageSrcset = `${image1xSource}, ${image2xSource} 2x`;
        } else {
            imageSrcset = `${image1xSource}, ${image2xSource} 2x, ${image3xSource} 3x`;
        }

        const imageHtml = renderFileImagePreviewContent({
            srcset: imageSrcset,
            // We need to set the image `max-width` and `max-height` since we don't want
            // the image growing to fill its parent if the image is smaller than the
            // parent (e.g. a small 32x32 image).
            maxWidth: `${fileSize.width}px`,
            maxHeight: `${fileSize.height}px`,
        });

        html.appendChild(imageHtml);
    }

    // If this is an image preview of a video then let's show a play button with
    // the timestamp. When the user clicks on the video we'll start playing it.
    if (typeof filePreview.videoDuration === "number") {
        const videoPlayerHtml = new HtmlElementGenerator("div");
        html.appendChild(videoPlayerHtml);
        videoPlayerHtml.setAttribute(
            "class",
            classNames(
                contentFileVideoPlayerStyles.containerClassName,
                contentFileVideoAndAudioPlayerControlsStyles.containerClassName,
                greyElevated2ClassName,
            ),
        );

        renderContentFileVideoPlayer(videoPlayerHtml, {
            spaceId,
            signedUrlSearch,
            file,
            durationMs: filePreview.videoDuration,
            layout,
            platform,
            isInitialAppRender,
            withoutInteractivity,
        });

        // We disable `user-select: text` on
        // `contentStyles.fileImagePreviewContentClassName` when
        // `contentStyles.fileClassName` has
        // `contentFileVideoPlayerStyles.containerClassName` because we want to render
        // a transparent `<img>` that covers video player controls. If the browser
        // renders a selection highlight over
        // `contentStyles.fileImagePreviewContentClassName` then it'll render under the
        // video controls and under the `<video>` element itself once the video is
        // playing.
        appendImageHtmlForSelection(html, platform);
    }
}

function renderContentFileCodePreview(
    html: HtmlElementGenerator,
    {
        file,
        filePreview,
        layout,
        screenWidth,
        platform,
        spacingScale,
    }: {
        file: FileModel;
        filePreview: FileCodePreview;
        layout: ContentFileLayout;
        screenWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
    },
) {
    html.setAttribute(
        "class",
        classNames(html.getAttribute("class"), sprinkles({backgroundColor: "grey-0"})),
    );

    // Make sure when we scale the file down, we continue to use the layout height
    // instead of the unscaled element height. To reproduce the bug which caused us
    // to add this: Scale down a code preview by adding another file to its file
    // row. Then add a comment to the code preview.
    html.setAttribute("style", `height: ${layout.height}px`);

    appendImageHtmlForSelection(html, platform);

    if (filePreview.content === "Processing" || (!filePreview.isProcessing && !filePreview.ok)) {
        if (!filePreview.isProcessing && !filePreview.ok) {
            renderContentFileProcessorErrorPreview(html, {
                contentType: file.contentType,
                error: filePreview.error,
                layout,
            });
        } else {
            renderContentFileProcessingPreview(html, {file, layout});
        }
        return;
    }

    const fullWidth = Math.min(
        contentStyles.blockMaxWidthRem[platform] * remPxBySpacingScale[spacingScale],
        screenWidth - screenPaddingXRem[platform] * remPxBySpacingScale[spacingScale] * 2,
    );

    const initialScale =
        fontSizesBySpacingScale["75"].small.fontSize /
        fontSizesBySpacingScale["100"].small.fontSize;
    const scale = Math.min(1, layout.width / fullWidth) * initialScale;

    const containerHtml = new HtmlElementGenerator("div");
    html.appendChild(containerHtml);

    containerHtml.setAttribute(
        "class",
        sprinkles({
            paddingLeft: "2.5",
            paddingTop: "2.5",
            overflow: "hidden",
        }),
    );

    containerHtml.setAttribute(
        "style",
        `width: ${fullWidth / initialScale}px; height: ${round6(
            layout.height / scale,
        )}px; transform-origin: top left; transform: scale(${round6(scale)})`,
    );

    const preHtml = new HtmlElementGenerator("pre");
    containerHtml.appendChild(preHtml);
    preHtml.setAttribute(
        "class",
        classNames(codeBlockWrapperClassName, contentStyles.filePreviewCodeBlockClassName),
    );

    const codeHtml = new HtmlElementGenerator("code");
    preHtml.appendChild(codeHtml);
    codeHtml.setAttribute("class", codeBlockClassName);

    let lineHtml = new HtmlElementGenerator("div");
    let lineContentHtml = new HtmlElementGenerator("div");
    codeHtml.appendChild(lineHtml);
    lineHtml.appendChild(lineContentHtml);
    lineHtml.setAttribute("class", codeBlockLineClassName);
    lineContentHtml.setAttribute("class", codeBlockLineContentClassName);

    let hadNewline = false;

    for (const contentItem of filePreview.content.get()) {
        if (hadNewline) {
            lineHtml = new HtmlElementGenerator("div");
            lineContentHtml = new HtmlElementGenerator("div");
            codeHtml.appendChild(lineHtml);
            lineHtml.appendChild(lineContentHtml);
            lineHtml.setAttribute("class", codeBlockLineClassName);
            lineContentHtml.setAttribute("class", codeBlockLineContentClassName);
        }
        hadNewline = false;

        switch (contentItem.type) {
            case "String": {
                if (contentItem.classes.length === 0) {
                    lineContentHtml.appendChild(new HtmlTextGenerator(contentItem.string));
                } else {
                    const spanHtml = new HtmlElementGenerator("span");
                    lineContentHtml.appendChild(spanHtml);
                    spanHtml.setAttribute("class", contentItem.classes);
                    spanHtml.appendChild(new HtmlTextGenerator(contentItem.string));
                }
                break;
            }
            case "Newline": {
                hadNewline = true;
                break;
            }
            default:
                throw exhaustive(contentItem);
        }
    }
}

// Round numbers to 3 decimal places so we sending less data over the
// network in our generated HTML.
function round6(n: number) {
    return Math.round(n * 10 ** 6) / 10 ** 6;
}

let wasEditorInitialAppRender = false;

let reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender: Map<
    string,
    Set<HTMLElement>
> | null = null;

/**
 * Render the `<img>` element for file image previews.
 *
 * As an optimization, we reuse image DOM elements across re-renders. All
 * `<img>` elements we render are placed in a pool. Then if we call
 * `renderFileImagePreviewContent()` again with the same `srcset` we reuse an
 * old `<img>` element if it's been removed from the DOM.
 *
 * This is noticeable on initial render if you open Chrome DevTools, go to the
 * Network tab, and turn on "Disable cache". Then reload the page. Without
 * pooling there will be two network requests for the same image. With pooling
 * there's only one. Normally caching will be turned on in Chrome so why bother
 * fixing this? Well Safari doesn't cache the image element source after it has
 * been removed from the DOM. So you always get two network requests from
 * Safari on initial render without pooling.
 */
function renderFileImagePreviewContent(options: {
    srcset: string;
    maxWidth: string;
    maxHeight: string;
}): HtmlGenerator {
    const reuseKey = JSON.stringify([
        options.srcset,
        options.maxWidth.trim(),
        options.maxHeight.trim(),
    ]);
    const reuseElements =
        reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender?.get(reuseKey);

    // If there's an existing `element` for this `srcset` that's not currently in
    // our document then let's reuse that element.
    if (reuseElements) {
        const reuseElement = iterableFind(
            reuseElements,
            element => !document.body.contains(element),
        );

        if (reuseElement) {
            reuseElements.delete(reuseElement);
            if (reuseElements.size === 0)
                reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender?.delete(
                    reuseKey,
                );

            let generator: HtmlGenerator | null = null;

            return {
                generateNode: () => reuseElement,
                generateHtml: () => {
                    generator ??= actuallyRenderFileImagePreviewContent(options);
                    return generator.generateHtml();
                },
                patchNode: (previous, node) => {
                    generator ??= actuallyRenderFileImagePreviewContent(options);
                    return generator.patchNode(previous, node);
                },
            };
        }
    }

    return actuallyRenderFileImagePreviewContent(options);
}

function actuallyRenderFileImagePreviewContent({
    srcset,
    maxWidth,
    maxHeight,
}: {
    srcset: string;
    maxWidth: string;
    maxHeight: string;
}): HtmlElementGenerator {
    const imageHtml = new HtmlElementGenerator("img");
    imageHtml.setAttribute("class", contentStyles.fileImagePreviewContentClassName);
    imageHtml.setAttribute("style", `max-width: ${maxWidth}; max-height: ${maxHeight}`);

    // Only load the image when it enters the viewport. For long documents with a
    // lot of images this improves network utilization. This means our signed URL in
    // `src` always needs to be up-to-date since we don't know when the browser will
    // need it.
    imageHtml.setAttribute("loading", "lazy");

    // Synchronously decode images. That way we don't need to wait for the
    // `decode()` method before we can present an image. Since preview images are
    // small we don't expect this to be a performance issue.
    //
    // This improves the user experience in `<ContentEditor>`s when moving files
    // around. If you move a file we don't need to re-fetch the image because the
    // browser has it cached. But if `decoding` is `async` then we do need to wait
    // for the `decode()` method which flashes the loading state for an image
    // temporarily while we wait for the image to decode.
    //
    // To test this, try adding and removing comments from files. This will
    // re-create the file `<img>` element but since the file is cached we shouldn't
    // have to show the loading indicator.
    imageHtml.setAttribute("decoding", "sync");

    const srcs = srcset.split(",");
    const firstSrc = srcs[0]!.trim();

    // The first source should not include a modifier like 2x. Since it's used as
    // the `<img>`'s default `src`.
    assert(!firstSrc.includes(" "));

    imageHtml.setAttribute("src", firstSrc);

    if (srcs.length > 1) {
        imageHtml.setAttribute("srcset", srcset);
    }

    return imageHtml;
}

export function getFileImagePreviewRenderingAdjustments(placeholder: FileImagePreviewPlaceholder) {
    const pixelGrid = placeholder.get();
    const pixelWidth = pixelGrid[0].length;
    const pixelHeight = pixelGrid.length;
    const pixelCount = pixelWidth * pixelHeight;

    let totalAlphaWeightedRed = 0;
    let totalAlphaWeightedGreen = 0;
    let totalAlphaWeightedBlue = 0;
    let totalAlpha = 0;

    for (const pixelRow of pixelGrid) {
        for (const pixel of pixelRow) {
            const alpha = pixel.alpha ?? 1;
            totalAlphaWeightedRed += pixel.r * alpha;
            totalAlphaWeightedGreen += pixel.g * alpha;
            totalAlphaWeightedBlue += pixel.b * alpha;
            totalAlpha += alpha;
        }
    }

    const averageRed = totalAlphaWeightedRed / totalAlpha;
    const averageGreen = totalAlphaWeightedGreen / totalAlpha;
    const averageBlue = totalAlphaWeightedBlue / totalAlpha;
    const averageAlpha = totalAlpha / pixelCount;

    const averageColor = Color.rgb(averageRed, averageGreen, averageBlue);
    const averageLuminosity = averageColor.luminosity();

    // Less than luminosity of `colors-100` + 0.05
    const isNearBlack = averageLuminosity < 0.08;

    // Less than luminosity of `colors-0` - 0.05
    const isNearWhite = averageLuminosity > 0.95;

    // If we have a subject on a transparent background then we don't want to
    // render borders around the image and instead let the subject bleed into the
    // page.
    const hasTransparentBackground = averageAlpha < 0.75;

    return {isNearBlack, isNearWhite, hasTransparentBackground};
}

export function renderFileImagePreviewPlaceholder(placeholder: FileImagePreviewPlaceholder) {
    const pixelGrid = placeholder.get();
    const pixelGridWidth = pixelGrid[0].length;
    const pixelGridHeight = pixelGrid.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixelGridWidth} ${pixelGridHeight}">`;

    const blurStdDeviation = 2 / 3;
    const translateX = -blurStdDeviation * 2;
    const translateY = -blurStdDeviation * 2;
    const scaleX = (pixelGridWidth + -translateX * 2) / pixelGridWidth;
    const scaleY = (pixelGridHeight + -translateY * 2) / pixelGridHeight;

    svg += `<filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="${round6(
        blurStdDeviation,
    )}" color-interpolation-filters="sRGB" /></filter><g filter="url(#blur)">`;

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

/**
 * Generate a blobby loading placeholder that looks like one of our image
 * preview placeholders that we'll render before we have the real data for the
 * image.
 */
function generateFileProcessingPreviewPlaceholder(
    file: FileModel,
): ReadonlyArray<ReadonlyArray<ColorWithShade>> {
    const fileSize = getFilePreviewSize(file);

    const baseSize = Math.floor(fileImagePreviewPlaceholderBaseSize * 0.6);

    const aspectRatio = clamp(
        minFilePreviewAspectRatio,
        fileSize.width / fileSize.height,
        maxFilePreviewAspectRatio,
    );
    const width = fileSize.width < fileSize.height ? baseSize : Math.round(baseSize * aspectRatio);
    const height = fileSize.width < fileSize.height ? Math.round(baseSize / aspectRatio) : baseSize;

    const stableRandom = new StableRandom(`FileLoadingPlaceholder:${file.id}-${width}-${height}`);

    const pixelCount = width * height;
    const backgroundPixelCount = Math.round((4 / 5) * pixelCount);
    const backgroundColor = "grey-0";

    const pixels = createArrayWithLength(pixelCount, (index): ColorWithShade => {
        if (index < backgroundPixelCount) return backgroundColor;

        const themeColor =
            themeColors[
                stableRandom.randomInteger("pixelThemeColor", index, 0, themeColors.length)
            ]!;

        return `${themeColor}-10`;
    });

    stableShuffleArray(stableRandom, "pixelShuffle", pixels);

    // Move any colored pixels out of the middle of the placeholder. Since we'll
    // have the loading indicator in the middle of the placeholder.
    {
        const middlePixelStartX = Math.floor((width - 1) / 2);
        const middlePixelEndX = Math.ceil((width - 1) / 2);

        const middlePixelStartY = Math.floor((height - 1) / 2);
        const middlePixelEndY = Math.ceil((height - 1) / 2);

        for (let middleY = middlePixelStartY; middleY <= middlePixelEndY; middleY++) {
            for (let middleX = middlePixelStartX; middleX <= middlePixelEndX; middleX++) {
                const pixelIndex = middleY * width + middleX;
                const pixelColor = pixels[pixelIndex]!;
                if (pixelColor === backgroundColor) continue;

                // Get any pixels with background pixels not in the middle we can swap our
                // colored pixel for.
                const backgroundPixelIndexes = filterMapArray(pixels, (pixel, index) => {
                    if (pixel !== backgroundColor) return;

                    const pixelY = Math.floor(index / width);
                    const pixelX = index % width;

                    if (
                        middlePixelStartX <= pixelX &&
                        middlePixelEndX <= pixelX &&
                        middlePixelStartY <= pixelY &&
                        pixelY <= middlePixelEndY
                    ) {
                        return;
                    }

                    return index;
                });
                if (backgroundPixelIndexes.length === 0) continue;

                const backgroundPixelIndex =
                    backgroundPixelIndexes[
                        stableRandom.randomInteger(
                            "pixelReshuffle",
                            pixelIndex,
                            0,
                            backgroundPixelIndexes.length,
                        )
                    ]!;

                pixels[backgroundPixelIndex] = pixelColor;
                pixels[pixelIndex] = backgroundColor;
            }
        }
    }

    const pixelGrid: Array<Array<ColorWithShade>> = [[]];

    for (const pixel of pixels) {
        const lastPixelRow = pixelGrid[pixelGrid.length - 1]!;

        if (lastPixelRow.length < width) {
            lastPixelRow.push(pixel);
        } else {
            pixelGrid.push([pixel]);
        }
    }

    return pixelGrid;
}

function renderFileProcessingPreviewPlaceholder(
    pixelGrid: ReadonlyArray<ReadonlyArray<ColorWithShade>>,
    {className = ""}: {className?: string} = {},
) {
    const pixelGridWidth = pixelGrid[0]!.length;
    const pixelGridHeight = pixelGrid.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="0 0 ${pixelGridWidth} ${pixelGridHeight}">`;

    const blurStdDeviation = 1 / 2;
    const translateX = -blurStdDeviation * 2;
    const translateY = -blurStdDeviation * 2;
    const scaleX = (pixelGridWidth + -translateX * 2) / pixelGridWidth;
    const scaleY = (pixelGridHeight + -translateY * 2) / pixelGridHeight;

    svg += `<filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="${round6(
        blurStdDeviation,
    )}" color-interpolation-filters="sRGB" /></filter><g filter="url(#blur)">`;

    for (let y = 0; y < pixelGrid.length; y++) {
        const pixelRow = pixelGrid[y]!;

        for (let x = 0; x < pixelRow.length; x++) {
            const pixel = pixelRow[x]!;

            svg +=
                `<rect ` +
                `x="${round6(x * scaleX + translateX)}" ` +
                `y="${round6(y * scaleY + translateY)}" ` +
                // Have `width` and `height` fill the remainder of the image so we don't get
                // any gaps between `<rect>`s from rounding errors when rendering the SVG.
                `width="${round6(scaleX)}" ` +
                `height="${round6(scaleY)}" ` +
                `style="fill: ${colorSchemeVars[pixel]}" />`;
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
        node,
        reference,
        attachmentTarget,
        expirationTimers,
        isInert = false,
        isInitialAppRender,
        isEditorInitialAppRender = false,
        rootNavigate,
        getReporter,
        onUpdate,
        onSignedUrlRefresh,
        onShiftMouseDown,
        onLongPress,
        onDrag,
        onOpenViewer,
    }: {
        spaceId: SpaceId;
        node: Node;
        reference: {signedUrlSearch: string; file: FileModel} | undefined;
        attachmentTarget: FileAttachmentTarget;
        expirationTimers: ContentFilePreviewExpirationTimers;
        isInert?: boolean;
        isInitialAppRender: boolean;
        isEditorInitialAppRender?: boolean;
        rootNavigate: NavigateFunction;
        getReporter: () => Reporter;
        onUpdate: (file: FileModel, signedUrlSearch: string) => void;
        onSignedUrlRefresh: (fileId: FileId, signedUrlSearch: string) => void;
        onShiftMouseDown?: (event: PointerEvent) => void;
        onLongPress?: () => void;
        onDrag?: (dragPromise: Promise<void>) => void;
        onOpenViewer?: () => {preventDefault: boolean} | void;
    },
): () => void {
    assert(element.classList.contains(fileClassName));

    let hasCleanedUp = false;
    let pollTimeout: Timeout | null = null;
    let unsubscribeFromRefreshTimer: (() => void) | null = null;

    /* ========================================================================== *\
     *                             Poll loading file                              *
    \* ========================================================================== */

    let cleanupPoll: (() => void) | undefined;

    if (reference?.file && reference.file.isLoading()) {
        cleanupPoll = getGlobalContext(ContentFilePollerContext).startPolling(getContext, {
            spaceId,
            fileId: reference.file.id,
            target: attachmentTarget,
            onPoll: ({file: newFile, signedUrlSearch}) => {
                onUpdate(newFile, signedUrlSearch);
            },
        });
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
    let isLongPress = false;

    const handlePointerDown = (event: PointerEvent) => {
        assert(!isInert);

        const wasEventPreviouslyDefaultPrevented = event.defaultPrevented;

        isPointerDownAndOver =
            !wasEventPreviouslyDefaultPrevented &&
            event.button === 0 &&
            !isModifiedPointerEvent(event);

        if (isPointerDownAndOver) {
            // Normally ProseMirror sets `element.draggable = true` on node selection
            // ([source][1]). But since we don't select our node until after a long press
            // let's start our `pointerdown` event by setting `element.draggable = true`.
            //
            // [1]: https://github.com/ProseMirror/prosemirror-view/blob/17b508f618c944c54776f8ddac45edcb49970796/src/viewdesc.ts#L838-L850
            if (getPlatformWithoutListening() !== "mobile") {
                element.draggable = true;
            }

            element.classList.add(contentStyles.pressedFileClassName);
        } else {
            element.classList.remove(contentStyles.pressedFileClassName);
        }
        element.classList.remove(contentStyles.longPressedFileClassName);

        longPressTimeout?.clear();
        longPressTimeout = null;
        isLongPress = false;

        // Always prevent default on mobile. This will:
        //
        // - Prevent the document from focusing (and keyboard from opening)
        // - Prevent the file from being dragged
        if (getPlatformWithoutListening() === "mobile") {
            event.preventDefault();
        } else {
            // By default, the browser will focus our `[contenteditable=true]` element on
            // `pointerdown`. We don't want this behavior but we can't call
            // `event.preventDefault()` since that'll also cancel the browser's ability to
            // drag our file. So instead, wait an animation frame and blur if the browser
            // focused our `[contenteditable=true]` element if it was unfocused when the
            // `pointerdown` ocurred.
            const docElement = element.closest<HTMLElement>(`.${contentStyles.docClassName}`);
            if (docElement) {
                const wasFocused = docElement === document.activeElement;
                if (!wasFocused) {
                    requestAnimationFrame(() => {
                        const isFocused = docElement === document.activeElement;
                        if (isFocused) docElement.blur();
                    });
                }
            }
        }

        // If the mouse performs a shift or alt click then we select the node instead
        // of opening the file viewer. This interaction is not obvious. You can also
        // use keyboard shortcuts or right click to select a file. The user should be
        // able to figure out one of these three methods.
        if (
            !wasEventPreviouslyDefaultPrevented &&
            event.pointerType === "mouse" &&
            (event.altKey || event.shiftKey)
        ) {
            onShiftMouseDown?.(event);
        } else if (isPointerDownAndOver && onLongPress) {
            // Emulate a `UILongPressGestureRecognizer` on iOS. Which [waits for a touch to
            // last 0.5 seconds][1] before firing.
            //
            // [1]: https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            longPressTimeout = createTimeout(() => {
                longPressTimeout = null;
                isLongPress = true;
                onLongPress();
            }, 500);
        }
    };

    const resetPointerState = () => {
        if (isInert) return;

        isPointerDownAndOver = false;

        // We set `element.draggable = true` on `pointerdown` and ProseMirror sets
        // `element.draggable = true` on node selection ([source][1]). So if the node
        // is selected, let ProseMirror set `element.draggable = false` instead of us.
        //
        // [1]: https://github.com/ProseMirror/prosemirror-view/blob/17b508f618c944c54776f8ddac45edcb49970796/src/viewdesc.ts#L838-L850
        if (!element.classList.contains("ProseMirror-selectednode") && element.draggable)
            element.draggable = false;

        element.classList.remove(contentStyles.pressedFileClassName);
        element.classList.remove(contentStyles.longPressedFileClassName);

        longPressTimeout?.clear();
        longPressTimeout = null;
        isLongPress = false;
    };

    const handlePointerUp = () => {
        assert(!isInert);

        const wasPointerDownAndOver = isPointerDownAndOver;
        const wasLongPress = isLongPress;
        resetPointerState();
        if (!wasPointerDownAndOver) return;
        if (wasLongPress) return;

        // If this is a video, then click doesn't open the file viewer but rather
        // plays/pauses the video.
        if (videoPlayerBehavior) {
            const result = videoPlayerBehavior?.onPress();
            if (result?.preventDefault) return;
        }

        // If this is audio, then click doesn't open the file viewer but rather
        // plays/pauses the audio.
        if (audioPlayerBehavior) {
            const result = audioPlayerBehavior?.onPress();
            if (result?.preventDefault) return;
        }

        openViewer();
    };

    const openViewer = () => {
        if (onOpenViewer) {
            const result = onOpenViewer();
            if (result?.preventDefault) return;
        }

        if (!reference) return;
        const {file} = reference;

        handoffContentFilePreviewState({
            ownedByElement: element,
            reference,
        });

        rootNavigate(location => {
            const searchParams = new URLSearchParams(location.search);

            searchParams.set(
                "file",
                // Space separator was chosen since it's encoded as a `+` which looks nice in
                // the URL.
                `${file.id} ${serializeFileAttachmentTargetString(attachmentTarget)}`,
            );

            return [
                {...location, search: searchParams.toString()},
                {
                    replace: true,
                    // Don't fetch route data from the server. We don't need any new route data.
                    //
                    // NOTE(calebmer, 2024-10-15): I just realized, instead of adding this private
                    // API with a patch it might be better to add the `shouldRevalidate` function to
                    // every route, look for specific changes, and ignore everything else. Like the
                    // `s.$spaceId.tsx` revalidation function which only returns true if the
                    // `SpaceId` changes.
                    unstable_shouldRevalidate: false,
                },
            ];
        });
    };

    const handlePointerLeave = resetPointerState;
    const handlePointerCancel = resetPointerState;
    const handleParentScrollWhenPointerDownAndOver = resetPointerState;

    const handleDragStart = (event: DragEvent) => {
        assert(!isInert);

        // Don't allow dragging with the web drag API on mobile.
        if (getPlatformWithoutListening() === "mobile") {
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        resetPointerState();

        // If we have a browser selection (whether it be `<ContentEditor>` or
        // `<ContentView>`) that includes the file and some other stuff then we want to
        // use ProseMirror's drag logic (or
        // `handleDragStartEventIfNotTextInputElement()` in the case of
        // `<ContentView>`). Otherwise we want to override ProseMirror's drag logic.
        const selection = window.getSelection();
        if (
            selection?.containsNode(element) &&
            (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode))
        ) {
            return;
        }

        if (!reference) return;
        if (!event.dataTransfer) return;

        // Don't propagate to ProseMirror. If the user starts dragging on a file and
        // only a file then we want `event.dataTransfer` to contain the file's HTML.
        // Not the selection HTML which might be something different.
        event.stopPropagation();

        const clipboardSerializer =
            ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                node.type.schema,
                () => spaceId,
                () => ({
                    ...emptyContentReferences,
                    fileById: new Map([[reference.file.id, reference]]),
                }),
                () => attachmentTarget,
            );

        const serializedNode = clipboardSerializer.serializeNode(node);
        assert(serializedNode instanceof HTMLElement);

        // See https://github.com/ProseMirror/prosemirror/issues/1156
        event.dataTransfer.effectAllowed = onDrag ? "copyMove" : "copy";

        event.dataTransfer.clearData();
        event.dataTransfer.setData("text/html", serializedNode.outerHTML);

        // NOTE(calebmer, 2024-10-15): I'd love to also include `image/png` here with a
        // `Blob` of the preview image like we do when copying (see the copy
        // implementation in our `contextmenu` handler). Unfortunately, generating a
        // `Blob` from a canvas is asynchronous. We could optimistically generate
        // `Blob`s in the background so they're available synchronously here but that's
        // too complicated for a feature that's not that important.

        // We check for this content type in the `dragenter` event to know if we need
        // to show file drop targets. If this is set then it's assumed `text/html` will
        // be parsed to `fileRow` or `file` nodes.
        event.dataTransfer.setData("application/x.alpine.file", "");

        if (onDrag) {
            const dragPromiseResolver = createPromiseResolver();

            const handleDragEnd = () => {
                element.removeEventListener("dragend", handleDragEnd);
                dragPromiseResolver.resolve();
            };

            // Attach `dragend` handler here since even if this content file's behavior is
            // cleaned up (say `reference` changes) we don't want to remove our `dragend`
            // event listener.
            element.addEventListener("dragend", handleDragEnd);

            onDrag(dragPromiseResolver.promise);
        }
    };

    if (!isInert) {
        element.addEventListener("pointerdown", handlePointerDown);
        element.addEventListener("pointerup", handlePointerUp);
        element.addEventListener("pointerleave", handlePointerLeave);
        element.addEventListener("pointercancel", handlePointerCancel);
        element.addEventListener("dragstart", handleDragStart);
        addParentScrollWhenPointerDownAndOverListener(
            element,
            handleParentScrollWhenPointerDownAndOver,
        );
    }

    /* ========================================================================== *\
     *                             Context menu event                             *
    \* ========================================================================== */

    const fileContentTypeNoun = getFileContentTypeNoun(reference?.file.contentType);

    const handleContextMenu = (event: MouseEvent) => {
        if (!navigator.clipboard) return;

        addContextMenuActions(event, [
            [
                {
                    label: `Copy ${fileContentTypeNoun}`,
                    isDisabled: reference?.file.isUploading ?? true,
                    pressErrorTitle: `Couldn’t copy ${fileContentTypeNoun}`,
                    onPress: async () => {
                        await handleCopyContentFile(element, {
                            spaceId,
                            node,
                            references: {
                                ...emptyContentReferences,
                                fileById: reference
                                    ? new Map([[reference.file.id, reference]])
                                    : new Map(),
                            },
                            attachmentTarget,
                        });
                    },
                },
                {
                    label: `Download ${fileContentTypeNoun}`,
                    isDisabled: reference?.file.isUploading ?? true,
                    pressErrorTitle: `Couldn’t download ${fileContentTypeNoun}`,
                    onPress: () => {
                        if (!reference) return;

                        handleDownloadContentFile({
                            spaceId,
                            file: reference.file,
                            signedUrlSearch: reference.signedUrlSearch,
                        });
                    },
                },
            ],
        ]);
    };

    element.addEventListener("contextmenu", handleContextMenu);

    /* ========================================================================== *\
     *                               Image elements                               *
    \* ========================================================================== */

    const imagePreviewContentElement = element.querySelector<HTMLImageElement>(
        `.${contentStyles.fileImagePreviewContentClassName}`,
    );

    // Wait until after `isEditorInitialAppRender` to cross fade in our images.
    // That way our cross fade animation won't ever be interrupted by unmounting
    // `<ContentView>` and replacing it with ProseMirror's `EditorView`.
    if (!isEditorInitialAppRender && imagePreviewContentElement) {
        const loadedPromise = isHtmlImageElementLoadedAndDecoded(imagePreviewContentElement);

        const handleLoad = () => {
            if (!element.classList.contains(contentStyles.loadedFileImagePreviewClassName)) {
                element.classList.add(contentStyles.loadedFileImagePreviewClassName);
            }
        };

        loadedPromise.then(
            () => {
                if (hasCleanedUp) return;

                if (!wasEditorInitialAppRender) {
                    handleLoad();
                }
                // If we're a microtask after `isEditorInitialAppRender` then only add the
                // loaded image class name after a macrotask (difference between microtask and
                // macrotask is important here). Since the CSS transition animation won't apply
                // if we immediately add the loaded class name.
                else {
                    scheduleMacrotask(handleLoad);
                }
            },
            error => {
                if (hasCleanedUp) return;

                scheduleUncaughtError(error);
            },
        );
    }

    let videoPlayerBehavior: {
        onPress: () => {preventDefault: boolean} | void;
        cleanup: () => void;
    } | null = null;
    if (
        reference?.file.preview?.type === "Image" &&
        typeof reference.file.preview.videoDuration === "number"
    ) {
        const containerElement = element.getElementsByClassName(
            contentFileVideoPlayerStyles.containerClassName,
        )[0];

        if (containerElement) {
            videoPlayerBehavior = addContentFileVideoPlayerBehavior(containerElement, {
                durationMs: reference.file.preview.videoDuration,
                isInitialAppRender,
                getReporter,
                onOpenViewer: openViewer,
            });
        }
    }

    let audioPlayerBehavior: {
        onPress: () => {preventDefault: boolean} | void;
        cleanup: () => void;
    } | null = null;
    if (
        reference?.file.preview?.type === "Audio" &&
        !reference.file.preview.isProcessing &&
        reference.file.preview.ok
    ) {
        const containerElement = element.getElementsByClassName(
            contentFileAudioPlayerStyles.containerClassName,
        )[0];

        if (containerElement) {
            audioPlayerBehavior = addContentFileAudioPlayerBehavior(containerElement, {
                filePreview: reference.file.preview,
                isInitialAppRender,
                getReporter,
                onOpenViewer: openViewer,
            });
        }
    }

    // Retain after all other behavior code runs to make sure we'll always release
    // even if an error is thrown.
    expirationTimers.retain();

    return () => {
        expirationTimers.release();

        hasCleanedUp = true;

        cleanupPoll?.();

        videoPlayerBehavior?.cleanup();
        audioPlayerBehavior?.cleanup();

        if (!isInert) {
            element.removeEventListener("pointerdown", handlePointerDown);
            element.removeEventListener("pointerup", handlePointerUp);
            element.removeEventListener("pointerleave", handlePointerLeave);
            element.removeEventListener("pointercancel", handlePointerCancel);
            element.removeEventListener("dragstart", handleDragStart);
            element.removeEventListener("contextmenu", handleContextMenu);
            removeParentScrollWhenPointerDownAndOverListener(
                element,
                handleParentScrollWhenPointerDownAndOver,
            );
        }

        resetPointerState();

        pollTimeout?.clear();
        pollTimeout = null;

        unsubscribeFromRefreshTimer?.();
        unsubscribeFromRefreshTimer = null;

        if (element.classList.contains(contentStyles.loadedFileImagePreviewClassName))
            element.classList.remove(contentStyles.loadedFileImagePreviewClassName);

        if (isEditorInitialAppRender && !wasEditorInitialAppRender) {
            wasEditorInitialAppRender = true;
            scheduleMicrotask(() => {
                wasEditorInitialAppRender = false;
            });
        }

        // On `<ContentEditor>`'s initial app render when we switch from
        // `<ContentView>` to ProseMirror's `EditorView` we want to reuse the `<img>`
        // element so we don't need to download the image file a second time.
        if (isEditorInitialAppRender && imagePreviewContentElement) {
            const imagePreviewContentKey = JSON.stringify([
                imagePreviewContentElement.getAttribute("srcset") ??
                    imagePreviewContentElement.getAttribute("src"),
                imagePreviewContentElement.style.maxWidth.trim(),
                imagePreviewContentElement.style.maxHeight.trim(),
            ]);

            reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender ??= new Map();

            getOrSetDefaultMapValue(
                reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender,
                imagePreviewContentKey,
                () => new Set(),
            ).add(imagePreviewContentElement);

            // If the image element hasn't been reused within a microtask from the reuse
            // map then we clean it up to avoid memory leaks.
            scheduleMicrotask(() => {
                const elements =
                    reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender?.get(
                        imagePreviewContentKey,
                    );

                if (elements?.delete(imagePreviewContentElement)) {
                    if (elements.size === 0)
                        reuseFileImagePreviewContentElementsByKeyForEditorInitialAppRender?.delete(
                            imagePreviewContentKey,
                        );
                }
            });
        }
    };
}

export async function handleCopyContentFile(
    element: Element,
    {
        spaceId,
        node,
        references,
        attachmentTarget,
    }: {
        spaceId: SpaceId;
        node: Node;
        references: ContentReferences;
        attachmentTarget: FileAttachmentTarget;
    },
) {
    const clipboardSerializer = ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
        node.type.schema,
        () => spaceId,
        () => references,
        () => attachmentTarget,
    );

    const serializedNode = clipboardSerializer.serializeNode(node);
    assert(serializedNode instanceof HTMLElement);

    const imagePreviewContentElement = element.querySelector<HTMLImageElement>(
        `.${contentStyles.fileImagePreviewContentClassName}`,
    );

    // Draw the preview image in a canvas and convert it to a `.png` blob.
    // Applications that don't support parsing `text/html` clipboard data (e.g.
    // Figma) can use the preview `image/png` to still paste the file.
    let imagePreviewContentBlob: Blob | null = null;
    if (
        imagePreviewContentElement &&
        imagePreviewContentElement.complete &&
        imagePreviewContentElement.naturalWidth > 0 &&
        imagePreviewContentElement.naturalHeight > 0
    ) {
        const canvasElement = document.createElement("canvas");

        // Absolute position the canvas so it doesn't affect document layout.
        canvasElement.style.position = "absolute";
        canvasElement.style.top = "0";
        canvasElement.style.left = "0";
        canvasElement.style.visibility = "hidden";

        document.body.appendChild(canvasElement);

        try {
            // `naturalWidth` and `naturalHeight` are density adjusted. To get the actual
            // image width/height we need to multiply the device pixel ratio.
            canvasElement.width = imagePreviewContentElement.naturalWidth * window.devicePixelRatio;
            canvasElement.height =
                imagePreviewContentElement.naturalHeight * window.devicePixelRatio;

            const canvasContext = assertExists(canvasElement.getContext("2d"));
            canvasContext.drawImage(
                imagePreviewContentElement,
                0,
                0,
                canvasElement.width,
                canvasElement.height,
            );

            imagePreviewContentBlob = await new Promise(resolve => {
                canvasElement.toBlob(resolve, "image/png");
            });

            // Silently error if converting to a blob fails.
            if (!imagePreviewContentBlob) {
                scheduleUncaughtError(new InternalError("Couldn't convert canvas to blob"));
            }
        } finally {
            document.body.removeChild(canvasElement);
        }
    }

    await navigator.clipboard.write([
        new ClipboardItem({
            "text/html": new Blob(
                [
                    serializedNode.outerHTML +
                        // Add a note for developers explaining that applications should prefer
                        // parsing `text/html` over `image/png`.
                        ` <!-- ${new URL(
                            "/notes/file-data-transfer-readme.md",
                            window.location.href,
                        ).toString()} -->`,
                ],
                {type: "text/html"},
            ),

            // The order here is important! If applications support both pasting
            // `text/html` and `image/png` then the application should first try parsing
            // `text/html` and then `image/png`. `text/html` contains a link to the full
            // resolution image whereas `image/png` is just the image preview.
            //
            // We can't add the full resolution image to the clipboard because:
            //
            // 1. The clipboard doesn't currently support `image/avif` files
            // 2. We don't have the full resolution image downloaded to the client in most
            //    cases
            //
            // If the user wants the full resolution image because the application they're
            // pasting into is picking the wrong one then they can select the download
            // option.
            ...(imagePreviewContentBlob
                ? {[imagePreviewContentBlob.type]: imagePreviewContentBlob}
                : {}),
        }),
    ]);
}

export function handleDownloadContentFile({
    spaceId,
    file,
    signedUrlSearch,
}: {
    spaceId: SpaceId;
    file: FileModel;
    signedUrlSearch: string;
}) {
    if (file.isUploading) {
        throw new FailedPreconditionError("File hasn't finished uploading", {
            displayMessage: errorDisplayMessage`The file hasn’t finished uploading. Wait a few seconds then try again.`,
        });
    }

    const downloadLinkElement = document.createElement("a");

    downloadLinkElement.setAttribute("download", getContentFileDownloadName(file));

    downloadLinkElement.href = `/files/${spaceId}/${file.id}${signedUrlSearch}`;

    downloadLinkElement.click();
}

export function getContentFileDownloadName(file: FileModel) {
    return (
        getFileContentTypeNoun(file.contentType) +
        "." +
        getFileContentTypePreferredExtension(file.contentType)
    );
}
