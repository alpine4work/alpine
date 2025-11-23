import {
    BlobsSettings,
    blobsDefaultSettings,
    getBlobsCanvasId,
} from "~/client/web/blobs/helpers/blobs_settings.js";
import {blobsArtStyles} from "~/client/web/styles/styles.js";
import {blobsArtGradientClassName} from "~/shared/design/core/constant_class_names.js";
import {HtmlElementGenerator, HtmlScriptGenerator} from "~/shared/helpers/html/html_generator.js";
import {
    safe,
    safeFlatObjectString,
    safeIdentifierString,
    safeNumber,
} from "~/shared/helpers/string/safe_string.js";

/**
 * Creates a div that houses the necessary canvas and scripts needed to render a blob.
 */
export function renderBlobsArtToHtml(
    props: Partial<BlobsSettings> & {
        seed: BlobsSettings["seed"];
        themeColor: BlobsSettings["themeColor"];
        hueSpread: BlobsSettings["hueSpread"];
    },
    {suppressHydrationWarning}: {suppressHydrationWarning: () => void},
) {
    const settings: BlobsSettings = {
        ...blobsDefaultSettings,
        ...props,
    };

    // Render previews at a smaller scale
    const scale = 0.4;

    const blobContainerHtml = new HtmlElementGenerator("div");
    blobContainerHtml.setAttribute("class", blobsArtStyles.containerClassName);

    // Set up canvas
    const canvasId = getBlobsCanvasId(settings, scale);
    const canvasHtml = blobContainerHtml.appendChild(new HtmlElementGenerator("canvas"));
    canvasHtml.setAttribute("data-blob-id", canvasId);
    canvasHtml.setAttribute("class", blobsArtStyles.canvasClassName);

    if (process.env.NODE_ENV !== "production") {
        canvasHtml.setAttribute("data-testid", `BlobsArtCanvas`);
    }

    // Set up gradient
    const gradientHtml = blobContainerHtml.appendChild(new HtmlElementGenerator("div"));
    gradientHtml.setAttribute("class", blobsArtGradientClassName);

    const safeCanvasId = safeIdentifierString(canvasId);
    // eslint-disable-next-line string-quotes
    const generateBlobs = safe`window.__drawBlobs('${safeCanvasId}', ${safeFlatObjectString(
        settings,
    )}, ${safeNumber(scale)})`;
    blobContainerHtml.appendChild(new HtmlScriptGenerator(generateBlobs));

    // Our blob `<script>` writes a `style` attribute on `blobContainerHtml`,
    // `canvasHtml`, and `gradientHtml`. Tell React not to log a hydration warning,
    // this is expected.
    suppressHydrationWarning();

    return blobContainerHtml;
}
