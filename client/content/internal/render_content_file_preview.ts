import {Node} from "prosemirror-model";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {getFilePreviewImageResizeWidth} from "~/shared/files/get_file_preview_image_resize_width.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertSvgToCssDataUrl} from "~/shared/helpers/html/convert_svg_to_css_data_url.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";

/**
 * Render the provided `file` node to an `HtmlElementGenerator`. This
 * `HtmlElementGenerator` can either be used to render `<ContentEditor>` or
 * `<ContentView>`.
 */
export function renderContentFilePreview(
    spaceId: SpaceId,
    node: Node,
    reference: {previewUrlSearch: string | null; file: FileModel} | undefined,
    layout: ContentFileLayout,
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

                const svg = renderFileImagePreviewPlaceholder(
                    reference.file.preview.size,
                    reference.file.preview.placeholder,
                );

                html.setAttribute(
                    "style",
                    [
                        `background-image: ${convertSvgToCssDataUrl(svg)}`,
                        "background-position: center top",
                        "background-size: cover",
                    ].join("; "),
                );

                // NOCOMMIT: Don't resize if file is less than width

                const imageSourcePathname = `/files/${spaceId}/${reference.file.id}${
                    reference.file.preview.content !== undefined ? "-preview" : ""
                }`;

                // NOCOMMIT: If `fileReference.previewUrlSearch` is expired we need to request
                // a new one
                const image1xSource = `${imageSourcePathname}${
                    reference.previewUrlSearch
                }&width=${getFilePreviewImageResizeWidth(layout.width)}`;

                const image2xSource = `${imageSourcePathname}${
                    reference.previewUrlSearch
                }&width=${getFilePreviewImageResizeWidth(layout.width * 2)}`;

                const image3xSource = `${imageSourcePathname}${
                    reference.previewUrlSearch
                }&width=${getFilePreviewImageResizeWidth(layout.width * 3)}`;

                // NOCOMMIT: Save and reuse image HTML DOM elements?
                const imageHtml = new HtmlElementGenerator("img");
                imageHtml.setAttribute("src", image1xSource);
                imageHtml.setAttribute(
                    "srcset",
                    `${image1xSource}, ${image2xSource} 2x, ${image3xSource} 3x`,
                );

                html.appendChild(imageHtml);

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
function round3(n: number) {
    return Math.round(n * 10 ** 3) / 10 ** 3;
}

function renderFileImagePreviewPlaceholder(
    size: FileImagePreviewSize,
    placeholder: FileImagePreviewPlaceholder,
) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}">`;

    const blurStdDeviation = size.width / 7;
    const translateX = -blurStdDeviation * 2;
    const translateY = -blurStdDeviation * 2;
    const scaleX = (size.width + -translateX * 2) / size.width;
    const scaleY = (size.height + -translateY * 2) / size.height;
    const pixelGrid = placeholder.get();
    const pixelWidth = size.width / pixelGrid[0].length;
    const pixelHeight = size.height / pixelGrid.length;

    svg += `<filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="${round3(
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
                `x="${round3(x * pixelWidth * scaleX + translateX)}" ` +
                `y="${round3(y * pixelHeight * scaleY + translateY)}" ` +
                // Have `width` and `height` fill the remainder of the image so we don't get
                // any gaps between `<rect>`s from rounding errors when rendering the SVG.
                `width="${round3(pixelWidth * scaleX)}" ` +
                `height="${round3(pixelHeight * scaleY)}" ` +
                `fill="${color}"${
                    pixel.alpha !== undefined ? ` fill-opacity="${pixel.alpha}"` : ""
                } />`;
        }
    }

    svg += "</g></svg>";
    return svg;
}
