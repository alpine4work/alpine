import classNames from "classnames";
import Color from "color";
import prettyBytes from "pretty-bytes";
import {Node} from "prosemirror-model";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/web/content/internal/content_base_schema_with_files.js";
import {ContentEditorDomClipboardSerializer} from "~/client/web/content/internal/content_editor_dom_clipboard_serializer.js";
import {
    addContentFileAudioPlayerBehavior,
    renderContentFileAudioPlayer,
} from "~/client/web/content/internal/content_file_audio_player.js";
import {renderContentFileErrorPreview} from "~/client/web/content/internal/content_file_error_preview.js";
import {ContentFileProcessorError} from "~/client/web/content/internal/content_file_processor_error.js";
import {
    addContentFileVideoPlayerBehavior,
    renderContentFileVideoPlayer,
} from "~/client/web/content/internal/content_file_video_player.js";
import {handoffContentFilePreviewState} from "~/client/web/content/internal/handoff_content_file_preview_state.js";
import {transparentImageDataUrl} from "~/client/web/content/internal/helpers/transparent_image_data_url.js";
import {getContentFileViewerSrc} from "~/client/web/content/internal/load_content_file_viewer_data.js";
import {
    ContentFileLayout,
    getFilePreviewSize,
} from "~/client/web/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {addContextMenuActions} from "~/client/web/design/context_menu.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {isHtmlImageElementLoadedAndDecoded} from "~/client/web/helpers/elements/is_html_image_element_loaded_and_decoded.js";
import {isModifiedPointerEvent} from "~/client/web/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/web/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {
    getIsInitialAppRender,
    getWasInitialAppRender,
} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {fileDottedIconSvg} from "~/client/web/icons/file_dotted_icon_svg.js";
import {spinnerGapIconSvg} from "~/client/web/icons/spinner_gap_icon_svg.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {getPlatformWithoutListening} from "~/client/web/remix/platform_context.js";
import {NavigateFunction} from "~/client/web/remix/use_navigate.js";
import {
    colorSchemeVars,
    contentFileAudioPlayerStyles,
    contentFileVideoAndAudioPlayerControlsStyles,
    contentFileVideoPlayerStyles,
    contentStyles,
    pulseAnimationClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {
    codeBlockClassName,
    codeBlockLineClassName,
    codeBlockLineContentClassName,
    codeBlockWrapper2ClassName,
    fileClassName,
    greyElevated2ClassName,
} from "~/shared/design/core/constant_class_names.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {ColorWithShade} from "~/shared/design/core/inverted_colors.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {
    FileImagePreviewPlaceholder,
    fileImagePreviewPlaceholderBaseSize,
} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel, FileModelData} from "~/shared/files/file_model.js";
import {
    FileCodePreview,
    FileImagePreview,
    FileImagePreviewSize,
} from "~/shared/files/file_preview.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {getContentFileDownloadNameFromContentType} from "~/shared/files/get_content_file_download_name_from_content_type.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {getFilePreviewImageResizeWidth} from "~/shared/files/get_file_preview_image_resize_width.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";

/**
 * Render the provided `file` node to an `HtmlElementGenerator`. This
 * `HtmlElementGenerator` can either be used to render `<ContentEditor>` or
 * `<ContentView>`.
 *
 * IMPORTANT: If you make a change to preview rendering here you should also
 * consider making the same change to `<ContentFileViewerModalDesktop>` and
 * `<ContentFileViewerModalMobile>`. We have three renderers for every file type.
 * The inline preview, the fullscreen desktop modal, and the fullscreen mobile
 * modal. They should all look and behave about the same.
 */
export function renderContentFilePreview({
    spaceId,
    node,
    file,
    layout,
    blockWidth,
    transformScale,
    platform,
    spacingScale,
    isInitialAppRender,
    withoutInteractivity = false,
}: {
    spaceId: SpaceId;
    node: Node;
    file: FileModelRegistryData | undefined;
    layout: ContentFileLayout;
    blockWidth: number;
    transformScale: number;
    platform: Platform;
    spacingScale: SpacingScale;
    isInitialAppRender: boolean;
    withoutInteractivity?: boolean;
}): HtmlElementGenerator {
    assert(node.type.name === "file");

    const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));

    assert(html instanceof HtmlElementGenerator);

    if (process.env.NODE_ENV !== "production" && file) {
        html.setAttribute("data-testid", `ContentFilePreview:${file.contentType}`);
    }

    appendSelectionBoundaryHtml(html);

    if (!file) {
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
    } else if (!file.preview) {
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
                // Push the loading spinner into the center with some padding top.
                paddingTop: "2",
            }),
        );

        unknownHtml.appendChild(
            createSvgHtmlGenerator(
                fileDottedIconSvg({
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
        unknownLabelHtml.appendChild(new HtmlTextGenerator(prettyBytes(file.contentLength)));

        appendImageHtmlForSelection(containerHtml, platform);
    } else {
        switch (file.preview.type) {
            case "Image": {
                renderContentFileImagePreview(html, {
                    spaceId,
                    file,
                    filePreview: file.preview,
                    layout,
                    transformScale,
                    platform,
                    spacingScale,
                    isInitialAppRender,
                    withoutInteractivity,
                });
                break;
            }
            case "Audio": {
                const audioSrc = getContentFileViewerSrc({spaceId, file});

                if (file.preview.isProcessing || audioSrc === null) {
                    renderContentFileProcessingPreview(html, {file, layout});
                } else if (!file.preview.ok) {
                    renderContentFileProcessorErrorPreview(html, {
                        contentType: file.contentType,
                        error: file.preview.error,
                        layout,
                        platform,
                        spacingScale,
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
                        file,
                        filePreview: file.preview,
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
                    file,
                    filePreview: file.preview,
                    layout,
                    blockWidth,
                    platform,
                    spacingScale,
                });
                break;
            }
            default:
                throw exhaustive(file.preview);
        }
    }

    return html;
}

/**
 * This space helps Chrome's selection logic. In many cases we've observed that
 * when selecting an element's contents instead of ending the selection at the end
 * of the element, Chrome will end the selection at the beginning of the next
 * selectable text node it finds! So when we don't have this text nodes, Chrome
 * automatically selects all files until the next selectable text node underneath.
 *
 * To test this case put two files on top of each other with some text above/below.
 * Then start dragging from the text above down. Without this text, Chrome selects
 * both files immediately once the paragraph at the top has been selected. Since
 * it's ending its selection in the next selectable text node (the paragraph
 * below).
 */
export function appendSelectionBoundaryHtml(containerHtml: HtmlElementGenerator) {
    const selectionBoundaryHtml = new HtmlElementGenerator("span");
    selectionBoundaryHtml.setAttribute(
        "style",
        "position: absolute; opacity: 0; user-select: text; -webkit-user-select: text",
    );
    containerHtml.appendChild(selectionBoundaryHtml);
    selectionBoundaryHtml.appendChild(new HtmlTextGenerator(" "));
}

/**
 * We add a transparent, invisible, image with `user-select: text` so that the
 * browser renders a selection highlight over the image when it's selected. Since
 * browsers like Chrome will render selection highlights over images.
 *
 * We don't add this image on mobile since Safari does weird things with a
 * selectable image in `contenteditable="true"`. This is consistent with our
 * `user-select` style for `fileImagePreviewContentClassName`.
 */
export function appendImageHtmlForSelection(
    containerHtml: HtmlElementGenerator,
    platform: Platform,
) {
    if (platform === "mobile") return;

    const imageHtmlForSelection = new HtmlElementGenerator("img");
    containerHtml.appendChild(imageHtmlForSelection);
    imageHtmlForSelection.setAttribute("aria-hidden", "true");
    imageHtmlForSelection.setAttribute("src", transparentImageDataUrl);
    imageHtmlForSelection.setAttribute("class", contentStyles.fileBlankImageForSelectionClassName);
}

function actuallyRenderContentFileProcessingPreview({
    file,
    layout,
}: {
    file: FileModelData;
    layout: {width: number; height: number};
}): HtmlElementGenerator {
    const schema = ContentBaseProsemirrorSchemaWithFiles.get();

    // NOTE(rohitt-gupta, 2025-04-09): here we are using non-null assertion
    // operator(`!`) because we know that `schema.nodes.file` will always be present in
    // the schema as it's in `baseNodes` of `createContentFileProsemirrorNodeSpecs`.
    //
    // check `createContentFileProsemirrorNodeSpecs` in
    // `shared/content/content_schema_extra.ts` for more details.
    const {html} = renderProsemirrorDomOutputSpec(
        schema.nodes.file!.spec.toDOM!(schema.nodes.file!.create()),
    );

    assert(html instanceof HtmlElementGenerator);

    renderContentFileProcessingPreview(html, {file, layout});

    return html;
}

export {actuallyRenderContentFileProcessingPreview as renderContentFileProcessingPreview};

function renderContentFileProcessingPreview(
    html: HtmlElementGenerator,
    {
        file,
        layout,
    }: {
        file: FileModelData;
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

    const placeholder = generateFileProcessingPreviewPlaceholder(file.id, layout);
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
            textAlign: "center",
            // Push the loading spinner into the center with some padding top.
            paddingTop: layout.width < 150 ? "2" : "4",
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
    if (file.isUploading) {
        processingHtml.appendChild(new HtmlTextGenerator("Uploading"));
    } else {
        processingHtml.appendChild(
            new HtmlTextGenerator(`Processing ${getFileContentTypeNoun(file.contentType)}`),
        );
    }
}

function renderContentFileProcessorErrorPreview(
    html: HtmlElementGenerator,
    {
        contentType,
        error,
        layout,
        platform,
        spacingScale,
    }: {
        contentType: FileContentType;
        error: FileProcessorError;
        layout: {width: number; height: number};
        platform: Platform;
        spacingScale: SpacingScale;
    },
) {
    const {title, displayMessage} = new ContentFileProcessorError(contentType, error);

    html.appendChild(
        renderContentFileErrorPreview({
            layout,
            icon: ({Unknown: "Warning", PasswordProtected: "Lock"} as const)[error.type],
            title,
            displayMessage,
            platform,
            spacingScale,
        }),
    );
}

function renderContentFileImagePreview(
    html: HtmlElementGenerator,
    {
        spaceId,
        file,
        filePreview,
        layout,
        transformScale,
        platform,
        spacingScale,
        isInitialAppRender,
        withoutInteractivity,
    }: {
        spaceId: SpaceId;
        file: FileModelRegistryData;
        filePreview: FileImagePreview;
        layout: ContentFileLayout;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
        withoutInteractivity: boolean;
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
                platform,
                spacingScale,
            });
        }
        return;
    }

    // This is the file size after applying scaling. If you want the actual pixel size
    // of the file use `reference.file.preview.size`.
    const fileSize = getFilePreviewSize(file);

    renderContentFileImagePreviewInner(html, {
        spaceId,
        file,
        fileSize,
        filePreview,
        filePreviewSize: filePreview.size,
        filePreviewPlaceholder: filePreview.placeholder,
        layout,
        transformScale,
        platform,
        isInitialAppRender,
        withoutInteractivity,
    });
}

function renderContentFileImagePreviewInner(
    html: HtmlElementGenerator,
    {
        spaceId,
        file,
        fileSize,
        filePreview,
        filePreviewSize,
        filePreviewPlaceholder,
        layout,
        transformScale,
        platform,
        isInitialAppRender,
        withoutInteractivity,
    }: {
        spaceId: SpaceId;
        file: FileModelRegistryData;
        fileSize: {width: number; height: number};
        filePreview: Exclude<FileImagePreview, {ok: false}>;
        filePreviewSize: FileImagePreviewSize;
        filePreviewPlaceholder: FileImagePreviewPlaceholder;
        layout: ContentFileLayout;
        transformScale: number;
        platform: Platform;
        isInitialAppRender: boolean;
        withoutInteractivity: boolean;
    },
) {
    const resourceServiceUrl = __RESOURCE_SERVICE_URL__;
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

    // We don't need a placeholder for images we've preloaded since we don't need to
    // wait for preloaded images to load from the network.
    if (file.imagePreviewContentIfSmall !== undefined) {
        html.setAttribute(
            "class",
            classNames(html.getAttribute("class"), contentStyles.loadedFileImagePreviewClassName),
        );
    } else {
        const svg = renderFileImagePreviewPlaceholder(fileSize, filePreviewPlaceholder);

        const placeholderImageHtml = new HtmlElementGenerator("img");
        placeholderImageHtml.setAttribute(
            "class",
            contentStyles.fileImagePreviewPlaceholderClassName,
        );
        placeholderImageHtml.setAttribute(
            "style",
            `max-width: ${fileSize.width}px; max-height: ${fileSize.height}px`,
        );
        // The placeholder image is purely decorative. It shouldn't be visible to assistive
        // technologies.
        placeholderImageHtml.setAttribute("aria-hidden", "true");
        placeholderImageHtml.setAttribute("src", convertSvgToDataUrl(svg));

        html.appendChild(placeholderImageHtml);
    }

    // If the file's aspect ratio doesn't match the layout aspect ratio, we need to
    // letter box the file. The file will be rendered with `object-fit: contain` and we
    // need to do something with the rest of the space in the file. So we render the
    // image placeholder behind the image with `object-fit: cover`.
    if (!adjustments.hasTransparentBackground) {
        // If the file is smaller than the space we've allocated for it, we need to
        // letterbox the file.
        let needsLetterbox = fileSize.width < layout.width || fileSize.height < layout.height;

        let containedFileWidth: number;
        let containedFileHeight: number;

        const fileSizeAspectRatio = fileSize.width / fileSize.height;
        const layoutAspectRatio = layout.width / layout.height;

        if (fileSizeAspectRatio < layoutAspectRatio) {
            containedFileWidth = fileSize.width * (layout.height / fileSize.height);
            containedFileHeight = layout.height;

            if (Math.round(layout.width) !== Math.round(containedFileWidth)) {
                needsLetterbox = true;
            }
        } else {
            containedFileWidth = layout.width;
            containedFileHeight = fileSize.height * (layout.width / fileSize.width);

            if (Math.round(layout.height) !== Math.round(containedFileHeight)) {
                needsLetterbox = true;
            }
        }

        if (needsLetterbox) {
            // Intentionally use `layout` when rendering the letterbox to not stretch out the
            // placeholder too much.
            const svg = renderFileImagePreviewPlaceholder(layout, filePreviewPlaceholder);

            const letterboxImageHtml = new HtmlElementGenerator("img");
            html.appendChild(letterboxImageHtml);

            letterboxImageHtml.setAttribute(
                "class",
                contentStyles.fileImagePreviewLetterboxClassName,
            );
            // The placeholder image is purely decorative. It shouldn't be visible to assistive
            // technologies.
            letterboxImageHtml.setAttribute("aria-hidden", "true");
            letterboxImageHtml.setAttribute("src", convertSvgToDataUrl(svg));

            // Use CSS `clip-path` to cut out the space inside the letterbox where the image
            // will be rendered. So if there's any transparency in the image the transparency
            // will render over our background color instead of the letterbox.
            //
            // We do round to the nearest pixel to avoid subpixel rendering artifacts at the
            // edges which does mean transparent pixels at the edges may render over the
            // letterbox but we think this is acceptable for now.
            if (fileSizeAspectRatio < layoutAspectRatio) {
                const barWidth = (layout.width - containedFileWidth) / 2;

                letterboxImageHtml.setAttribute(
                    "style",
                    // eslint-disable-next-line cyberworlds/string-quotes
                    `clip-path: path('M 0 0 H ${Math.ceil(barWidth)} V ${layout.height} H 0 Z M ${layout.width - Math.ceil(barWidth)} 0 H ${layout.width} V ${layout.height} H ${layout.width - Math.ceil(barWidth)} Z')`,
                );
            } else {
                const barHeight = (layout.height - containedFileHeight) / 2;

                letterboxImageHtml.setAttribute(
                    "style",
                    // eslint-disable-next-line cyberworlds/string-quotes
                    `clip-path: path('M 0 0 H ${layout.width} V ${Math.ceil(barHeight)} H 0 Z M 0 ${layout.height - Math.ceil(barHeight)} H ${layout.width} V ${layout.height} H 0 Z')`,
                );
            }
        }
    }

    // Render the image if we have a signed preview URL and the signature isn't
    // expired.
    //
    // When the signature expires we re-render the file to remove the image from the
    // DOM. `addContentFilePreviewBehavior()` is responsible for fetching new
    // signatures that haven't expired.
    if (!file.isSignedUrlExpired && filePreview.content !== "Processing") {
        const imageSourceBase = `${resourceServiceUrl}/files/${spaceId}/${file.id}${
            file.signedUrlSearch
        }${filePreview.content !== undefined ? "&variant=preview" : ""}`;

        let image1xSource: string;
        let image2xSource: string;
        let image3xSource: string;

        // Don't resize vector images. They're already infinitely resizable.
        const isVectorImage =
            (filePreview.content?.contentType ?? file.contentType) === "image/svg+xml";

        // NOTE(ifitzsimmons, #dont-resize-gifs): We stopped resizing gifs because they
        // take too long (often timing out at 30 seconds).
        const isGif = (filePreview.content?.contentType ?? file.contentType) === "image/gif";

        if (isVectorImage || isGif) {
            image1xSource = imageSourceBase;
            image2xSource = imageSourceBase;
            image3xSource = imageSourceBase;
        } else {
            const image1xWidth = getFilePreviewImageResizeWidth(layout.width * transformScale);
            const image2xWidth = getFilePreviewImageResizeWidth(layout.width * 2 * transformScale);
            const image3xWidth = getFilePreviewImageResizeWidth(layout.width * 3 * transformScale);

            // If the file is smaller than our desired resize width then don't bother resizing
            // since resizing will be a noop.
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

        let imageSrcset: string;
        if (image1xSource === image2xSource) {
            imageSrcset = image1xSource;
        } else if (image2xSource === image3xSource) {
            imageSrcset = `${image1xSource}, ${image2xSource} 2x`;
        } else {
            imageSrcset = `${image1xSource}, ${image2xSource} 2x, ${image3xSource} 3x`;
        }

        const imageHtml = renderFileImagePreviewContent({
            // If we preloaded the image preview content because it was less than 100kb then
            // our image element source should be a base64 data URL so we can skip loading data
            // from the network.
            srcset:
                file.imagePreviewContentIfSmall !== undefined
                    ? `data:${filePreview.content?.contentType ?? file.contentType};base64,${
                          file.imagePreviewContentIfSmall
                      }`
                    : imageSrcset,
            // We need to set the image `max-width` and `max-height` since we don't want the
            // image growing to fill its parent if the image is smaller than the parent (e.g. a
            // small 32x32 image).
            maxWidth: `${fileSize.width}px`,
            maxHeight: `${fileSize.height}px`,
        });

        html.appendChild(imageHtml);
    }

    // If this is an image preview of a video then let's show a play button with the
    // timestamp. When the user clicks on the video we'll start playing it.
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
        // `contentFileVideoPlayerStyles.containerClassName` because we want to render a
        // transparent `<img>` that covers video player controls. If the browser renders a
        // selection highlight over `contentStyles.fileImagePreviewContentClassName` then
        // it'll render under the video controls and under the `<video>` element itself
        // once the video is playing.
        appendImageHtmlForSelection(html, platform);
    }
}

function renderContentFileCodePreview(
    html: HtmlElementGenerator,
    {
        file,
        filePreview,
        layout,
        blockWidth,
        platform,
        spacingScale,
    }: {
        file: FileModelRegistryData;
        filePreview: FileCodePreview;
        layout: ContentFileLayout;
        blockWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
    },
) {
    html.setAttribute(
        "class",
        classNames(html.getAttribute("class"), sprinkles({backgroundColor: "grey-0"})),
    );

    // Make sure when we scale the file down, we continue to use the layout height
    // instead of the unscaled element height. To reproduce the bug which caused us to
    // add this: Scale down a code preview by adding another file to its file row. Then
    // add a comment to the code preview.
    html.setAttribute("style", `height: ${layout.height}px`);

    appendImageHtmlForSelection(html, platform);

    if (filePreview.content === "Processing" || (!filePreview.isProcessing && !filePreview.ok)) {
        if (!filePreview.isProcessing && !filePreview.ok) {
            renderContentFileProcessorErrorPreview(html, {
                contentType: file.contentType,
                error: filePreview.error,
                layout,
                platform,
                spacingScale,
            });
        } else {
            renderContentFileProcessingPreview(html, {file, layout});
        }
        return;
    }

    const initialScale =
        fontSizesBySpacingScale["75"].small.fontSize /
        fontSizesBySpacingScale["100"].small.fontSize;
    const scale = Math.min(1, layout.width / blockWidth) * initialScale;

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
        `width: ${blockWidth / initialScale}px; height: ${round6(
            layout.height / scale,
        )}px; transform-origin: top left; transform: scale(${round6(scale)})`,
    );

    const preHtml = new HtmlElementGenerator("pre");
    containerHtml.appendChild(preHtml);
    preHtml.setAttribute(
        "class",
        classNames(codeBlockWrapper2ClassName, contentStyles.filePreviewCodeBlockClassName),
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

// Round numbers to 3 decimal places so we sending less data over the network in
// our generated HTML.
function round6(n: number) {
    return Math.round(n * 10 ** 6) / 10 ** 6;
}

/**
 * Render the `<img>` element for file image previews.
 *
 * As an optimization, we reuse image DOM elements across re-renders. All `<img>`
 * elements we render are placed in a pool. Then if we call
 * `renderFileImagePreviewContent()` again with the same `srcset` we reuse an old
 * `<img>` element if it's been removed from the DOM.
 *
 * This is noticeable on initial render if you open Chrome DevTools, go to the
 * Network tab, and turn on "Disable cache". Then reload the page. Without pooling
 * there will be two network requests for the same image. With pooling there's only
 * one. Normally caching will be turned on in Chrome so why bother fixing this?
 * Well Safari doesn't cache the image element source after it has been removed
 * from the DOM. So you always get two network requests from Safari on initial
 * render without pooling.
 */
function renderFileImagePreviewContent({
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

    // Only load the image when it enters the viewport. For long documents with a lot
    // of images this improves network utilization. This means our signed URL in `src`
    // always needs to be up-to-date since we don't know when the browser will need it.
    imageHtml.setAttribute("loading", "lazy");

    // Synchronously decode images. That way we don't need to wait for the `decode()`
    // method before we can present an image. Since preview images are small we don't
    // expect this to be a performance issue.
    //
    // This improves the user experience in `<ContentEditor>`s when moving files
    // around. If you move a file we don't need to re-fetch the image because the
    // browser has it cached. But if `decoding` is `async` then we do need to wait for
    // the `decode()` method which flashes the loading state for an image temporarily
    // while we wait for the image to decode.
    //
    // To test this, try adding and removing comments from files. This will re-create
    // the file `<img>` element but since the file is cached we shouldn't have to show
    // the loading indicator.
    imageHtml.setAttribute("decoding", "sync");

    // Needed to get a proper CORS response from the resource service where our files
    // are hosted.
    imageHtml.setAttribute("crossorigin", "anonymous");

    const srcs = srcset.startsWith("data:") ? [srcset] : srcset.split(",");
    const firstSrc = srcs[0]!.trim();

    // The first source should not include a modifier like 2x. Since it's used as the
    // `<img>`'s default `src`.
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
    //
    // The constant was picked to support rendering the screenshots in this blog post
    // with a transparent background:
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/4xpwf206e4bq72kxvb7d0bm110
    const isNearWhite = averageLuminosity > 0.97;

    // If we have a subject on a transparent background then we don't want to render
    // borders around the image and instead let the subject bleed into the page.
    const hasTransparentBackground = averageAlpha < 0.75;

    return {isNearBlack, isNearWhite, hasTransparentBackground};
}

export function renderFileImagePreviewPlaceholder(
    fileSize: {width: number; height: number},
    placeholder: FileImagePreviewPlaceholder,
) {
    /* eslint-disable cyberworlds/string-quotes */

    const pixelGrid = placeholder.get();
    const pixelGridWidth = pixelGrid[0].length;
    const pixelGridHeight = pixelGrid.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fileSize.width} ${fileSize.height}">`;

    const rectWidthBase = fileSize.width / pixelGridWidth;
    const rectHeightBase = fileSize.height / pixelGridHeight;
    const blurStdDeviation = (2 / 3) * Math.min(rectWidthBase, rectHeightBase);
    const translateX = -blurStdDeviation * 2;
    const translateY = -blurStdDeviation * 2;
    const rectWidth = rectWidthBase + -translateX * 2;
    const rectHeight = rectHeightBase + -translateY * 2;

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
                `x="${round6(x * rectWidth + translateX)}" ` +
                `y="${round6(y * rectHeight + translateY)}" ` +
                // Have `width` and `height` fill the remainder of the image so we don't get any
                // gaps between `<rect>`s from rounding errors when rendering the SVG.
                `width="${round6(rectWidth)}" ` +
                `height="${round6(rectHeight)}" ` +
                `fill="${color}"${
                    pixel.alpha !== undefined ? ` fill-opacity="${pixel.alpha}"` : ""
                } />`;
        }
    }

    svg += "</g></svg>";
    return svg;

    /* eslint-enable cyberworlds/string-quotes */
}

/**
 * Generate a blobby loading placeholder that looks like one of our image preview
 * placeholders that we'll render before we have the real data for the image.
 */
function generateFileProcessingPreviewPlaceholder(
    fileId: FileId,
    layout: {width: number; height: number},
): ReadonlyArray<ReadonlyArray<ColorWithShade>> {
    const baseSize = Math.floor(fileImagePreviewPlaceholderBaseSize * 0.6);

    const aspectRatio = layout.width / layout.height;
    const width = layout.width < layout.height ? baseSize : Math.round(baseSize * aspectRatio);
    const height = layout.width < layout.height ? Math.round(baseSize / aspectRatio) : baseSize;

    const stableRandom = new StableRandom(`FileLoadingPlaceholder:${fileId}-${width}-${height}`);

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

    // Move any colored pixels out of the middle of the placeholder. Since we'll have
    // the loading indicator in the middle of the placeholder.
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

                // Get any pixels with background pixels not in the middle we can swap our colored
                // pixel for.
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
    /* eslint-disable cyberworlds/string-quotes */

    const pixelGridWidth = pixelGrid[0]!.length;
    const pixelGridHeight = pixelGrid.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="0 0 ${pixelGridWidth} ${pixelGridHeight}" preserveAspectRatio="xMidYMid slice">`;

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
                // Have `width` and `height` fill the remainder of the image so we don't get any
                // gaps between `<rect>`s from rounding errors when rendering the SVG.
                `width="${round6(scaleX)}" ` +
                `height="${round6(scaleY)}" ` +
                `style="fill: ${colorSchemeVars[pixel]}" />`;
        }
    }

    svg += "</g></svg>";
    return svg;

    /* eslint-enable cyberworlds/string-quotes */
}

export function addContentFilePreviewBehaviorBase(
    element: HTMLElement,
    {
        isInert = false,
        onPress,
        onShiftMouseDown,
        isLongPressDisabled,
        onLongPress,
        onDragStart,
    }: {
        isInert?: boolean;
        onPress?: (event: PointerEvent) => void;
        onShiftMouseDown?: (event: PointerEvent) => void;
        isLongPressDisabled?: () => boolean;
        onLongPress?: () => void;
        onDragStart?: (dataTransfer: DataTransfer) => void;
    },
): () => void {
    assert(element.classList.contains(fileClassName));

    /* ========================================================================== *\
     *                                Press event                                 *
    \* ========================================================================== */

    let isPointerDownAndOver = false;
    let longPressTimeout: Timeout | null = null;
    let isLongPress = false;

    const handlePointerDown = (event: PointerEvent) => {
        assert(!isInert);

        const wasEventPreviouslyDefaultPrevented = event.defaultPrevented;

        const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
            event,
            getClientInfo(),
        );

        isPointerDownAndOver =
            !wasEventPreviouslyDefaultPrevented &&
            event.button === 0 &&
            !(isModifiedPointerEvent(event) && !isOpenLinkInSeparateTabEvent);

        if (isPointerDownAndOver) {
            // Normally ProseMirror sets `element.draggable = true` on node selection
            // ([source][1]). But since we don't select our node until after a long press let's
            // start our `pointerdown` event by setting `element.draggable = true`.
            //
            // [1]:
            //     https://github.com/ProseMirror/prosemirror-view/blob/17b508f618c944c54776f8ddac45edcb49970796/src/viewdesc.ts#L838-L850
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
        } else if (!event.shiftKey) {
            // By default, the browser will focus our `[contenteditable=true]` element on
            // `pointerdown`. We don't want this behavior but we can't call
            // `event.preventDefault()` since that'll also cancel the browser's ability to drag
            // our file. So instead, wait an animation frame and blur if the browser focused
            // our `[contenteditable=true]` element if it was unfocused when the `pointerdown`
            // occurred.
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

        // If the mouse performs a shift or alt click then we select the node instead of
        // opening the file viewer. This interaction is not obvious. You can also use
        // keyboard shortcuts or right click to select a file. The user should be able to
        // figure out one of these three methods.
        if (
            !wasEventPreviouslyDefaultPrevented &&
            event.pointerType === "mouse" &&
            (event.altKey || event.shiftKey)
        ) {
            onShiftMouseDown?.(event);
        } else if (isPointerDownAndOver && onLongPress && !isLongPressDisabled?.()) {
            // Emulate a `UILongPressGestureRecognizer` on iOS. Which [waits for a touch to
            // last 0.5 seconds][1] before firing.
            //
            // [1]:
            //     https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            longPressTimeout = createTimeout(() => {
                longPressTimeout = null;

                if (!isLongPressDisabled?.()) {
                    isLongPress = true;
                    onLongPress();
                }
            }, 500);
        }
    };

    const resetPointerState = () => {
        if (isInert) return;

        isPointerDownAndOver = false;

        // We set `element.draggable = true` on `pointerdown` and ProseMirror sets
        // `element.draggable = true` on node selection ([source][1]). So if the node is
        // selected, let ProseMirror set `element.draggable = false` instead of us.
        //
        // [1]:
        //     https://github.com/ProseMirror/prosemirror-view/blob/17b508f618c944c54776f8ddac45edcb49970796/src/viewdesc.ts#L838-L850
        if (!element.classList.contains("ProseMirror-selectednode") && element.draggable)
            element.draggable = false;

        element.classList.remove(contentStyles.pressedFileClassName);
        element.classList.remove(contentStyles.longPressedFileClassName);

        longPressTimeout?.clear();
        longPressTimeout = null;
        isLongPress = false;
    };

    const handlePointerUp = (event: PointerEvent) => {
        assert(!isInert);

        const wasPointerDownAndOver = isPointerDownAndOver;
        const wasLongPress = isLongPress;
        resetPointerState();
        if (!wasPointerDownAndOver) return;
        if (wasLongPress) return;

        onPress?.(event);
    };

    const handlePointerLeave = resetPointerState;
    const handlePointerCancel = resetPointerState;
    const handleScroll = resetPointerState;

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
        // `<ContentView>`) that includes the file and some other stuff then we want to use
        // ProseMirror's drag logic (or `handleDragStartEventIfNotTextInputElement()` in
        // the case of `<ContentView>`). Otherwise we want to override ProseMirror's drag
        // logic.
        const selection = window.getSelection();
        if (
            selection?.containsNode(element) &&
            (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode))
        ) {
            return;
        }

        if (!event.dataTransfer) return;

        // Don't propagate to ProseMirror. If the user starts dragging on a file and only a
        // file then we want `event.dataTransfer` to contain the file's HTML. Not the
        // selection HTML which might be something different.
        event.stopPropagation();

        const elementRect = element.getBoundingClientRect();

        // Make sure we use the current element as the drag image. I've found sometimes
        // Chrome picks the wrong drag image otherwise.
        event.dataTransfer.setDragImage(
            element,
            event.clientX - elementRect.left,
            event.clientY - elementRect.top,
        );

        onDragStart?.(event.dataTransfer);
    };

    const scrollEventTargets: Array<EventTarget> = [window];

    if (!isInert) {
        element.addEventListener("pointerdown", handlePointerDown);
        element.addEventListener("pointerup", handlePointerUp);
        element.addEventListener("pointerleave", handlePointerLeave);
        element.addEventListener("pointercancel", handlePointerCancel);
        element.addEventListener("dragstart", handleDragStart);

        // Search for all scrollable parent elements so we can attach a scroll handler that
        // resets our press.
        //
        // We don't use `addParentScrollWhenPointerDownAndOverListener()` like other node
        // views in `<ContentEditor>` because content file previews are rendered outside of
        // `<ContentEditor>` and `<ContentView>`. For example, `<MessageViewFiles>` and
        // `<ContentFileMiniPreview>`. `addParentScrollWhenPointerDownAndOverListener()`
        // only works if the element is inside a `<ContentEditor>` or `<ContentView>` which
        // listen to scroll events for their children.
        {
            let parentElement = element.parentElement;
            while (parentElement) {
                const {overflowX, overflowY} = getComputedStyle(parentElement);

                if (
                    overflowX === "auto" ||
                    overflowX === "scroll" ||
                    overflowY === "auto" ||
                    overflowY === "scroll"
                ) {
                    scrollEventTargets.push(parentElement);
                }

                parentElement =
                    parentElement.parentElement !== document.body
                        ? parentElement.parentElement
                        : null;
            }
        }

        for (const scrollEventTarget of scrollEventTargets) {
            scrollEventTarget.addEventListener("scroll", handleScroll, true);
        }
    }

    return () => {
        if (!isInert) {
            element.removeEventListener("pointerdown", handlePointerDown);
            element.removeEventListener("pointerup", handlePointerUp);
            element.removeEventListener("pointerleave", handlePointerLeave);
            element.removeEventListener("pointercancel", handlePointerCancel);
            element.removeEventListener("dragstart", handleDragStart);

            for (const scrollEventTarget of scrollEventTargets) {
                scrollEventTarget.removeEventListener("scroll", handleScroll, true);
            }
        }

        resetPointerState();
    };
}

let contentFileImagePreviewContentLoadingState: {
    count: number;
    promiseResolver: PromiseResolver<void>;
} | null = null;

export async function internalWaitForContentFileImagePreviewContentsToLoad() {
    await contentFileImagePreviewContentLoadingState?.promiseResolver.promise;
}

export function addContentFilePreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {
        spaceId,
        file,
        attachmentTarget,
        isInert = false,
        rootNavigate,
        getReporter,
        onShiftMouseDown,
        isLongPressDisabled,
        onLongPress,
        onDrag,
        onOpenViewer,
    }: {
        spaceId: SpaceId;
        file: FileModelRegistryData | undefined;
        attachmentTarget: FileAttachmentTarget | "Uploader";
        isInert?: boolean;
        rootNavigate: NavigateFunction;
        getReporter: () => Reporter;
        onShiftMouseDown?: (event: PointerEvent) => void;
        isLongPressDisabled?: () => boolean;
        onLongPress?: () => void;
        onDrag?: (dragPromise: Promise<void>) => void;
        onOpenViewer?: () => {preventDefault: boolean} | void;
    },
): () => void {
    // Shouldn't add file preview behavior until after initial app render.
    assert(!getIsInitialAppRender());

    let hasCleanedUp = false;
    let pollTimeout: Timeout | null = null;
    let unsubscribeFromRefreshTimer: (() => void) | null = null;

    const cleanupBase = addContentFilePreviewBehaviorBase(element, {
        isInert,
        onShiftMouseDown,
        isLongPressDisabled,
        onLongPress,
        onPress: () => {
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
        },
        onDragStart: dataTransfer => {
            if (!file) return;

            const schema = ContentBaseProsemirrorSchemaWithFiles.get();

            const clipboardSerializer =
                ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                    schema,
                    () => spaceId,
                    () => ({
                        ...emptyContentReferences,
                        fileById: new Map([
                            [
                                file.id,
                                {signedUrlSearch: file.signedUrlSearch, file: new FileModel(file)},
                            ],
                        ]),
                    }),
                    () => attachmentTarget,
                );

            const node = schema.node("file", {fileId: file.id});

            const serializedNode = clipboardSerializer.serializeNode(node);
            assert(serializedNode instanceof HTMLElement);

            // See https://github.com/ProseMirror/prosemirror/issues/1156
            dataTransfer.effectAllowed = onDrag ? "copyMove" : "copy";

            dataTransfer.clearData();
            dataTransfer.setData("text/html", serializedNode.outerHTML);

            // NOTE(calebmer, 2024-10-15): I'd love to also include `image/png` here with a
            // `Blob` of the preview image like we do when copying (see the copy implementation
            // in our `contextmenu` handler). Unfortunately, generating a `Blob` from a canvas
            // is asynchronous. We could optimistically generate `Blob`s in the background so
            // they're available synchronously here but that's too complicated for a feature
            // that's not that important.

            // We check for this content type in the `dragenter` event to know if we need to
            // show file drop targets. If this is set then it's assumed `text/html` will be
            // parsed to `fileRow` or `file` nodes.
            dataTransfer.setData("application/x.alpine.file", "");

            if (onDrag) {
                const dragPromiseResolver = createPromiseResolver();

                const handleDragEnd = () => {
                    element.removeEventListener("dragend", handleDragEnd);
                    dragPromiseResolver.resolve();
                };

                // Attach `dragend` handler here since even if this content file's behavior is
                // cleaned up (say `reference` changes) we don't want to remove our `dragend` event
                // listener.
                element.addEventListener("dragend", handleDragEnd);

                onDrag(dragPromiseResolver.promise);
            }
        },
    });

    const openViewer = () => {
        if (isInert) return;

        if (onOpenViewer) {
            const result = onOpenViewer();
            if (result?.preventDefault) return;
        }

        if (!file) return;

        handoffContentFilePreviewState({
            ownedByElement: element,
            signedUrlSearch: file.signedUrlSearch,
            file: new FileModel(file),
        });

        rootNavigate(location => {
            const searchParams = new URLSearchParams(location.search);

            searchParams.set(
                "file",
                // Space separator was chosen since it's encoded as a `+` which looks nice in the
                // URL.
                attachmentTarget === "Uploader"
                    ? file.id
                    : `${file.id} ${serializeFileAttachmentTargetString(attachmentTarget)}`,
            );

            return [
                {...location, search: searchParams.toString()},
                {
                    replace: true,
                    // Don't fetch route data from the server. We don't need any new route data.
                    //
                    // NOTE(calebmer, 2024-10-15): I just realized, instead of adding this private API
                    // with a patch it might be better to add the `shouldRevalidate` function to every
                    // route, look for specific changes, and ignore everything else. Like the
                    // `s.$spaceId.tsx` revalidation function which only returns true if the `SpaceId`
                    // changes.
                    unstable_shouldRevalidate: false,
                },
            ];
        });
    };

    /* ========================================================================== *\
     *                             Context menu event                             *
    \* ========================================================================== */

    const fileContentTypeNoun = getFileContentTypeNoun(file?.contentType);

    const handleContextMenu = (event: MouseEvent) => {
        if (!navigator.clipboard || isInert) return;

        addContextMenuActions(event, [
            [
                {
                    label: `Copy ${fileContentTypeNoun}`,
                    isDisabled: file?.isUploading ?? true,
                    pressErrorTitle: `Couldn\u2019t copy ${fileContentTypeNoun}`,
                    onPress: async () => {
                        await handleCopyContentFile(element, {
                            spaceId,
                            file: file ?? null,
                            attachmentTarget,
                        });
                    },
                },
                {
                    label: `Download ${fileContentTypeNoun}`,
                    isDisabled: file?.isUploading ?? true,
                    pressErrorTitle: `Couldn\u2019t download ${fileContentTypeNoun}`,
                    onPress: () => {
                        if (!file) return;
                        handleDownloadContentFile({spaceId, file});
                    },
                },
            ],
        ]);
    };

    element.addEventListener("contextmenu", handleContextMenu);

    /* ========================================================================== *\
     *                               Image elements                               *
    \* ========================================================================== */

    const imagePreviewContentElement = element.querySelector<HTMLImageElement>(
        `.${contentStyles.fileImagePreviewContentClassName}`,
    );

    if (!imagePreviewContentElement) {
        if (element.classList.contains(contentStyles.loadedFileImagePreviewClassName))
            element.classList.remove(contentStyles.loadedFileImagePreviewClassName);
    }
    // If we have the file's image content already loaded then we don't need to wait
    // for the file to load from the network.
    else if (file?.imagePreviewContentIfSmall === undefined) {
        const loadedPromise = isHtmlImageElementLoadedAndDecoded(imagePreviewContentElement);

        // Remove the loaded class if the image isn't available synchronously. If the image
        // is available synchronously then this whole branch will noop. Which is good, if
        // we removed the loaded class then added it back the fade in animation would
        // rerun.
        if (
            loadedPromise.isPending() &&
            element.classList.contains(contentStyles.loadedFileImagePreviewClassName)
        ) {
            element.classList.remove(contentStyles.loadedFileImagePreviewClassName);
        }

        contentFileImagePreviewContentLoadingState ??= {
            count: 0,
            promiseResolver: createPromiseResolver(),
        };
        contentFileImagePreviewContentLoadingState.count++;

        const handleLoad = () => {
            if (!element.classList.contains(contentStyles.loadedFileImagePreviewClassName)) {
                element.classList.add(contentStyles.loadedFileImagePreviewClassName);
            }

            // Wait for the animation to finish before resolving our loading state promise.
            createTimeout(
                decrementLoadingStateCount,
                contentStyles.loadedFileImageAnimationDurationMs,
            );
        };

        const decrementLoadingStateCount = () => {
            assert(contentFileImagePreviewContentLoadingState);
            contentFileImagePreviewContentLoadingState.count--;

            if (contentFileImagePreviewContentLoadingState.count === 0) {
                contentFileImagePreviewContentLoadingState.promiseResolver.resolve();
                contentFileImagePreviewContentLoadingState = null;
            }
        };

        let isSync = true;

        loadedPromise.then(
            () => {
                if (hasCleanedUp) {
                    decrementLoadingStateCount();
                    return;
                }

                // If the image was loaded synchronously and the element doesn't currently have the
                // loaded class name then wait a microtask before adding the loaded class name.
                // That way we guarantee the fade in animation runs.
                //
                // This is needed when rendering after `isInitialAppRender`. Since the file may
                // have loaded while we were waiting for React to mount. Even if the file is
                // already loaded we still want to make sure the fade in animation plays.
                if (isSync && getWasInitialAppRender()) {
                    scheduleMacrotask(handleLoad);
                } else {
                    handleLoad();
                }
            },
            error => {
                if (hasCleanedUp) {
                    decrementLoadingStateCount();
                    return;
                }

                scheduleUncaughtError(error);
                decrementLoadingStateCount();
            },
        );

        isSync = false;
    }

    let videoPlayerBehavior: {
        onPress: () => {preventDefault: boolean} | void;
        cleanup: () => void;
    } | null = null;
    if (
        !isInert &&
        file?.preview?.type === "Image" &&
        typeof file.preview.videoDuration === "number"
    ) {
        const containerElement = element.getElementsByClassName(
            contentFileVideoPlayerStyles.containerClassName,
        )[0];

        if (containerElement) {
            videoPlayerBehavior = addContentFileVideoPlayerBehavior(containerElement, {
                durationMs: file.preview.videoDuration,
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
        !isInert &&
        file?.preview?.type === "Audio" &&
        !file.preview.isProcessing &&
        file.preview.ok
    ) {
        const containerElement = element.getElementsByClassName(
            contentFileAudioPlayerStyles.containerClassName,
        )[0];

        if (containerElement) {
            audioPlayerBehavior = addContentFileAudioPlayerBehavior(containerElement, {
                filePreview: file.preview,
                getReporter,
                onOpenViewer: openViewer,
            });
        }
    }

    const stopMaintainingFile = file
        ? getFileRegistry(spaceId).startMaintainingFile(getContext, file, attachmentTarget)
        : null;

    return () => {
        hasCleanedUp = true;

        cleanupBase();

        stopMaintainingFile?.();

        videoPlayerBehavior?.cleanup();
        audioPlayerBehavior?.cleanup();

        element.removeEventListener("contextmenu", handleContextMenu);

        pollTimeout?.clear();
        pollTimeout = null;

        unsubscribeFromRefreshTimer?.();
        unsubscribeFromRefreshTimer = null;
    };
}

export async function handleCopyContentFile(
    element: Element,
    {
        spaceId,
        file,
        attachmentTarget,
    }: {
        spaceId: SpaceId;
        file: FileModelRegistryData | null;
        attachmentTarget: FileAttachmentTarget | "Uploader";
    },
) {
    const schema = ContentBaseProsemirrorSchemaWithFiles.get();

    const node = schema.node("file", {fileId: file?.id ?? null});

    const references: ContentReferences = {
        ...emptyContentReferences,
        fileById: file
            ? new Map([
                  [
                      file.id,
                      {
                          signedUrlSearch: file.signedUrlSearch,
                          file: new FileModel(file),
                      },
                  ],
              ])
            : new Map(),
    };

    const clipboardSerializer = ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
        schema,
        () => spaceId,
        () => references,
        () => attachmentTarget,
    );

    const serializedNode = clipboardSerializer.serializeNode(node);
    assert(serializedNode instanceof HTMLElement);

    const imagePreviewContentElement = element.querySelector<HTMLImageElement>(
        `.${contentStyles.fileImagePreviewContentClassName}`,
    );

    // Draw the preview image in a canvas and convert it to a `.png` blob. Applications
    // that don't support parsing `text/html` clipboard data (e.g. Figma) can use the
    // preview `image/png` to still paste the file.
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
            // `naturalWidth` and `naturalHeight` are density adjusted. To get the actual image
            // width/height we need to multiply the device pixel ratio.
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
                scheduleUncaughtError(new InternalError("Couldn\u2019t convert canvas to blob"));
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
                        // Add a note for developers explaining that applications should prefer parsing
                        // `text/html` over `image/png`.
                        ` <!-- ${new URL(
                            "/notes/file-data-transfer-readme.md",
                            window.location.href,
                        ).toString()} -->`,
                ],
                {type: "text/html"},
            ),

            // The order here is important! If applications support both pasting `text/html`
            // and `image/png` then the application should first try parsing `text/html` and
            // then `image/png`. `text/html` contains a link to the full resolution image
            // whereas `image/png` is just the image preview.
            //
            // We can't add the full resolution image to the clipboard because:
            //
            // 1. The clipboard doesn't currently support `image/avif` files
            // 2. We don't have the full resolution image downloaded to the client in most
            //    cases
            //
            // If the user wants the full resolution image because the application they're
            // pasting into is picking the wrong one then they can select the download option.
            ...(imagePreviewContentBlob
                ? {[imagePreviewContentBlob.type]: imagePreviewContentBlob}
                : {}),
        }),
    ]);
}

export function handleDownloadContentFile({
    spaceId,
    file,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
}) {
    if (file.isUploading) {
        throw new FailedPreconditionError("File hasn\u2019t finished uploading", {
            displayMessage: errorDisplayMessage`The file hasn\u2019t finished uploading. Wait a few seconds then try again.`,
        });
    }

    const downloadLinkElement = document.createElement("a");

    // Setting the `download` attribute is not strictly necessary since we're setting
    // the `Content-Disposition` header in ResourceService to force the browser to
    // download the file instead of navigating to it, but just in case the header is
    // not set for some reason we'll still set the `download` attribute.
    downloadLinkElement.setAttribute(
        "download",
        getContentFileDownloadNameFromContentType(file.contentType),
    );
    const resourceServiceUrl = __RESOURCE_SERVICE_URL__;

    downloadLinkElement.href = `${resourceServiceUrl}/download/files/${spaceId}/${file.id}${file.signedUrlSearch}`;

    downloadLinkElement.click();
}
