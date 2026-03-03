let filePreviewImageResizeWidths: Set<number> | null = null;

function getFilePreviewImageResizeWidths() {
    if (filePreviewImageResizeWidths === null) {
        // Only 6 sizes below 1400 for us to choose from when resizing. This increases the
        // chance of cache hits. We need to include larger sizes when rendering file
        // previews at full screen width. For example, in document presentation mode on a
        // large monitor.
        //
        // Sizes increase in increments of 200px up until 1000px and then increases in
        // increments of 400px. We'd like to keep the total list of supported widths low to
        // improve the likelihood of cache hits on our resize backend.
        filePreviewImageResizeWidths ??= new Set(
            [200, 400, 600, 800, 1000, 1400, 1800, 2200, 2600, 3000, 3400, 3800, 4200].reverse(),
        );
    }

    return filePreviewImageResizeWidths;
}

/**
 * Get the smallest resize width that's larger than the provided width. For
 * example, if you're trying to render an image in a 185px slot then this function
 * will return 200px. If you're trying to render an image in a 377px slot then this
 * function will return 400px.
 *
 * There are ~8 total resize widths. These widths were selected to support the most
 * common file sizes. Namely:
 *
 * - An image at 1/3 width of content (200px on desktop)
 * - An image at 2/3 width of content (400px on desktop)
 * - An image at the full width of content (600px on desktop, 768px is the maximum
 *   width of content on mobile since that's the media query breakpoint where we
 *   transition to mobile)
 *
 * Then we multiple our base sizes by 2x and 3x to account for screens with a 2x
 * pixel density and 3x pixel density respectively.
 */
export function getFilePreviewImageResizeWidth(width: number): number {
    let lastResizeWidth: number | undefined;

    for (const resizeWidth of getFilePreviewImageResizeWidths()) {
        if (width > resizeWidth) return lastResizeWidth ?? resizeWidth;
        lastResizeWidth = resizeWidth;
    }

    return lastResizeWidth!;
}

/**
 * Is this a valid resize width?
 */
export function isFilePreviewImageResizeWidth(width: number): boolean {
    return getFilePreviewImageResizeWidths().has(width);
}
