import {
    BlobsSettings,
    blobsCanvasHeightPx,
    blobsCanvasWidthPx,
    blobsDefaultSettings,
    getBlobsCanvasId,
} from "~/client/blobs/helpers/blobs_settings.js";
import {blobsArtStyles} from "~/client/styles/styles.js";
import {HtmlElementGenerator, HtmlScriptGenerator} from "~/shared/helpers/html/html_generator.js";
import {
    safe,
    safeFlatObjectString,
    safeIdentifierString,
} from "~/shared/helpers/string/safe_string.js";

/**
 * Creates a div that houses the necessary canvas and scripts needed to render a blob.
 */
export function getBlobsHtmlGenerator(
    props: Partial<BlobsSettings> & {
        seed: BlobsSettings["seed"];
        themeColor: BlobsSettings["themeColor"];
        hueSpread: BlobsSettings["hueSpread"];
    },
) {
    const settings: BlobsSettings = {
        ...blobsDefaultSettings,
        ...props,
    };

    const blobContainerHtml = new HtmlElementGenerator("div");
    blobContainerHtml.setAttribute("class", blobsArtStyles.containerClassName);
    blobContainerHtml.setAttribute(
        "style",
        [
            `height: ${blobsCanvasHeightPx}px`,
            `width: ${blobsCanvasWidthPx}px`,
            `left: calc(50% - (${blobsCanvasWidthPx / 2}px))`,
            "transform: scale(40%)",
        ].join("; "),
    );

    // Set up canvas
    const canvasId = getBlobsCanvasId(settings);
    const canvasHtml = blobContainerHtml.appendChild(new HtmlElementGenerator("canvas"));
    canvasHtml.setAttribute("data-blob-id", canvasId);
    canvasHtml.setAttribute("class", blobsArtStyles.canvasClassName);
    canvasHtml.setAttribute("width", blobsCanvasWidthPx);
    canvasHtml.setAttribute("height", blobsCanvasHeightPx);

    // Set up gradient
    const gradientHtml = blobContainerHtml.appendChild(new HtmlElementGenerator("div"));
    gradientHtml.setAttribute("class", blobsArtStyles.gradientClassName);

    const safeCanvasId = safeIdentifierString(canvasId);
    // eslint-disable-next-line string-quotes
    const generateBlobs = safe`window.__drawBlobs('${safeCanvasId}', ${safeFlatObjectString(
        settings,
    )})`;
    blobContainerHtml.appendChild(new HtmlScriptGenerator(generateBlobs));

    return blobContainerHtml;
}
