import {Node} from "prosemirror-model";
import {ContentReferences} from "~/shared/content/content_references.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertSvgToCssDataUrl} from "~/shared/helpers/html/convert_svg_to_css_data_url.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";

/**
 * Render the provided `file` node to an `HtmlElementGenerator`. This
 * `HtmlElementGenerator` can either be used to render `<ContentEditor>` or
 * `<ContentView>`.
 */
export function renderContentFilePreview(
    node: Node,
    contentReferences: ContentReferences,
): HtmlElementGenerator {
    assert(node.type.name === "file");

    const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));

    assert(html instanceof HtmlElementGenerator);

    const fileId: FileId | null = node.attrs.id;
    const file = fileId ? contentReferences.fileById.get(fileId) : undefined;

    if (!file) {
        // NOCOMMIT: Implement
    } else if (!file.preview) {
        // NOCOMMIT: Implement
    } else {
        switch (file.preview.type) {
            case "Audio": {
                // NOCOMMIT: Implement
                break;
            }
            case "Code": {
                // NOCOMMIT: Implement
                break;
            }
            case "Image": {
                if (
                    (!file.preview.isProcessing && !file.preview.ok) ||
                    file.preview.placeholder === "Processing" ||
                    file.preview.size === "Processing"
                ) {
                    // NOCOMMIT: Implement
                    break;
                }

                const svg = renderFileImagePreviewPlaceholder(
                    file.preview.size,
                    file.preview.placeholder,
                );

                html.setAttribute(
                    "style",
                    [
                        `background-image: ${convertSvgToCssDataUrl(svg)}`,
                        "background-position: center top",
                        "background-size: cover",
                    ].join("; "),
                );

                if (typeof file.preview.videoDuration === "number") {
                    // NOCOMMIT: Implement
                }
                break;
            }
            default:
                throw exhaustive(file.preview);
        }
    }

    return html;
}
function renderFileImagePreviewPlaceholder(
    size: FileImagePreviewSize,
    placeholder: FileImagePreviewPlaceholder,
) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}">`;

    const blurStdDeviation = size.width / 8;
    const translateX = -blurStdDeviation * 2;
    const translateY = -blurStdDeviation * 2;
    const scaleX = (size.width + -translateX * 2) / size.width;
    const scaleY = (size.height + -translateY * 2) / size.height;
    const pixelGrid = placeholder.get();
    const pixelWidth = size.width / pixelGrid[0].length;
    const pixelHeight = size.height / pixelGrid.length;

    svg += `<filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="${blurStdDeviation}" /></filter><g filter="url(#blur)">`;

    for (let y = 0; y < pixelGrid.length; y++) {
        const pixelRow = pixelGrid[y]!;

        for (let x = 0; x < pixelRow.length; x++) {
            const pixel = pixelRow[x]!;
            const color =
                "#" +
                pixel.r.toString(16).padStart(2, "0") +
                pixel.g.toString(16).padStart(2, "0") +
                pixel.b.toString(16).padStart(2, "0") +
                (pixel.alpha !== undefined ? pixel.alpha.toString(16).padStart(2, "0") : "");

            svg +=
                `<rect ` +
                `x="${x * pixelWidth * scaleX + translateX}" ` +
                `y="${y * pixelHeight * scaleY + translateY}" ` +
                // Have `width` and `height` fill the remainder of the image so we don't get
                // any gaps between `<rect>`s from rounding errors when rendering the SVG.
                `width="${(size.width - x * pixelWidth) * scaleX}" ` +
                `height="${(size.height - y * pixelHeight) * scaleY}" ` +
                `fill="${color}" />`;
        }
    }

    svg += "</g></svg>";
    return svg;
}
