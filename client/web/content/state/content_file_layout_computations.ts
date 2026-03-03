import * as kiwi from "@lume/kiwi";
import {documentCommentThreadPreviewHeight} from "~/client/web/styles/document_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RemLength, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * The fallback file aspect ratio we use when we don't have a way to preview the
 * file. For example binary files or files with an error message.
 */
const fallbackFileAspectRatio = 3 / 2;

// Use the larger `remPx` size (mobile) and the larger block max width (mobile).
// The file will be scaled down as necessary.
const largeFallbackFileWidth = contentStyles.blockMaxWidthRem.mobile * remPxBySpacingScale.large;
const largeFallbackFileHeight = largeFallbackFileWidth / fallbackFileAspectRatio;
const largeFallbackFileSize = {width: largeFallbackFileWidth, height: largeFallbackFileHeight};

const smallFallbackFileWidth = 200;
const smallFallbackFileHeight = smallFallbackFileWidth / fallbackFileAspectRatio;
const smallFallbackFileSize = {width: smallFallbackFileWidth, height: smallFallbackFileHeight};

// Aspect ratio of letter paper. https://en.wikipedia.org/wiki/Letter_(paper_size)
const letterPaperAspectRatio = 17 / 22;

// Round numbers to 3 decimal places so we sending less data over the network in
// our generated HTML.
function round3(n: number) {
    return Math.round(n * 10 ** 3) / 10 ** 3;
}

function round6(n: number) {
    return Math.round(n * 10 ** 6) / 10 ** 6;
}

export type ContentFileLayout = {
    readonly width: number;
    readonly widthFr: number;
    readonly height: number;
};

/**
 * Layout the files in a file row. Uses the [Cassowary algorithm][1] (specifically
 * the [`@lume/kiwi`][2] JavaScript implementation) to determine the most aesthetic
 * layout for up to three files in a row. The key constraint of our layout
 * algorithm is all files should share the same height and should ideally fill our
 * full content width all while preserving the underlying files' aspect ratios.
 *
 * [Apple's Auto Layout framework][3] for iOS and OS X development is also based on
 * the Cassowary algorithm. Which is what gives us confidence for the performance
 * of this approach.
 *
 * Layout satisfies the following constraints:
 *
 * - Must be larger than our minimum size and smaller than our maximum size
 * - Must have the same height across all files in the row
 * - Should maintain the aspect ratio of the underlying files
 * - Should have the file widths add up to the document width
 *
 * [1]: https://en.wikipedia.org/wiki/Cassowary_(software)
 * [2]: https://github.com/lume/kiwi
 * [3]:
 *     https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/index.html
 */
export function computeContentFileRowLikeLayout<
    Files extends Array<FileModelData | FileEntityId | null>,
>(
    files: Files,
    options: {
        maxFileCount: number;
        blockWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
        maxHeight?: RemLength;
    },
): {[Key in keyof Files]: ContentFileLayout} {
    assert(files.length >= 1);
    assert(files.length <= 3);

    const {
        maxFileCount,
        blockWidth,
        spacingScale,
        maxHeight: rowMaxHeight = spacing[contentStyles.fileRowMaxHeight],
    } = options;

    const remPx = remPxBySpacingScale[spacingScale];
    const minWidth = contentStyles.fileMinSizeRem * remPx;
    const fairlySplitBlockWidth =
        (blockWidth - contentStyles.fileRowGapWidthRem * remPx * (files.length - 1)) / files.length;

    const solver = new kiwi.Solver();

    const sizeVariables: Array<{width: kiwi.Variable; height: kiwi.Variable; actualSize: number}> =
        [];
    let firstHeightVariable: kiwi.Variable | null = null;

    for (const file of files) {
        const {width, height} = getFileOrFileEntityPreviewSize(files.length, file, options);

        const widthVariable = new kiwi.Variable();
        const heightVariable = new kiwi.Variable();

        sizeVariables.push({
            width: widthVariable,
            height: heightVariable,
            // If `width` isn't set then assume `width` as close is an even share of the
            // `blockWidth`.
            actualSize: (width ?? fairlySplitBlockWidth) * height,
        });

        // All files in a row must have the same height.
        if (firstHeightVariable === null) {
            firstHeightVariable = heightVariable;
        } else {
            solver.addConstraint(
                new kiwi.Constraint(
                    heightVariable,
                    kiwi.Operator.Eq,
                    firstHeightVariable,
                    kiwi.Strength.required,
                ),
            );
        }

        // Add `width` bounds. `width` should be larger than our min file size and less
        // than the file's original width (since making a small file larger will start to
        // add resize artifacts).
        //
        // The maximum width is also implicitly bound by the constraint we add below this
        // loop adding up all `widthVariables` and requiring that they're less than our
        // file row's width.
        {
            const maxWidth = width !== null ? Math.max(minWidth, width) : null;

            if (minWidth === maxWidth) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Eq,
                        minWidth,
                        kiwi.Strength.required,
                    ),
                );
            } else {
                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Ge,
                        minWidth,
                        kiwi.Strength.required,
                    ),
                );

                if (maxWidth !== null) {
                    solver.addConstraint(
                        new kiwi.Constraint(
                            widthVariable,
                            kiwi.Operator.Le,
                            maxWidth,
                            kiwi.Strength.required,
                        ),
                    );
                } else {
                    // If there's no `maxWidth` (because there's no `width`) then we want the file to
                    // be close to a fair share of the block width. But it's perfectly fine to break
                    // this constraint.
                    solver.addConstraint(
                        new kiwi.Constraint(
                            widthVariable,
                            kiwi.Operator.Eq,
                            fairlySplitBlockWidth,
                            kiwi.Strength.weak,
                        ),
                    );
                }
            }
        }

        // Add `height` bounds. `height` should be larger than our min file size and less
        // than both the file's original height (since making a small file larger will
        // start to add resize artifacts) and the file row's maximum height.
        {
            const minHeight = contentStyles.fileMinSizeRem * remPx;
            const maxHeight = clamp(
                minHeight,
                height,
                convertRemLengthToPx(rowMaxHeight, spacingScale),
            );

            if (minHeight === maxHeight) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        heightVariable,
                        kiwi.Operator.Eq,
                        minHeight,
                        kiwi.Strength.required,
                    ),
                );
            } else {
                solver.addConstraint(
                    new kiwi.Constraint(
                        heightVariable,
                        kiwi.Operator.Ge,
                        minHeight,
                        kiwi.Strength.required,
                    ),
                );

                solver.addConstraint(
                    new kiwi.Constraint(
                        heightVariable,
                        kiwi.Operator.Le,
                        maxHeight,
                        kiwi.Strength.required,
                    ),
                );
            }

            // If there's no width then we want the file's height to be as close to the
            // declared height as possible.
            if (width === null) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        heightVariable,
                        kiwi.Operator.Eq,
                        height,
                        kiwi.Strength.strong,
                    ),
                );
            }
        }

        // Maintain the aspect ratio of the file as best we can. This constraint isn't
        // required, the solver may break it if necessary.
        //
        // If there's no `width` then the aspect ratio is flexible. But we still add this
        // constraint with a `>=` operator to make sure the file doesn't get squished next
        // to other files.
        solver.addConstraint(
            new kiwi.Constraint(
                widthVariable.minus(
                    heightVariable.multiply(
                        clamp(
                            minFilePreviewAspectRatio,
                            (width ?? fairlySplitBlockWidth) / height,
                            maxFilePreviewAspectRatio,
                        ),
                    ),
                ),
                width !== null ? kiwi.Operator.Eq : kiwi.Operator.Ge,
                0,
                kiwi.Strength.strong,
            ),
        );
    }

    // When we add up all our widths it must be less than the total `fileRowWidth`.
    // Ideally the width is exactly equal to `fileRowWidth` but that's not possible if
    // we have smaller files.
    //
    // `fileRowWidth` is best case. We don't rerun our layout function whenever the
    // file row's width changes. Instead we hope we're taking up the full block max
    // width or we're taking the full screen on smaller devices. If the file row width
    // isn't exactly what we expect then we'll have to start cropping content in the
    // file.
    {
        let widthExpression: kiwi.Variable | kiwi.Expression = sizeVariables[0]!.width;

        for (let i = 1; i < sizeVariables.length; i++) {
            const widthVariable = sizeVariables[i]!.width;
            widthExpression = widthExpression
                .plus(contentStyles.fileRowGapWidthRem * remPx)
                .plus(widthVariable);
        }

        // If all the files in the row were `minWidth` and still wouldn't fit in
        // `blockWidth` then we remove the constraint that our widths must sum up to
        // `blockWidth`. This only kicks in for recursive document file entities which end
        // up rendering documents at a very small size.
        if (
            blockWidth >=
            minWidth * maxFileCount + contentStyles.fileRowGapWidthRem * remPx * (maxFileCount - 1)
        ) {
            solver.addConstraint(
                new kiwi.Constraint(
                    widthExpression,
                    kiwi.Operator.Le,
                    blockWidth,
                    kiwi.Strength.required,
                ),
            );
        }

        // We think it's most aesthetically pleasing when files fill our row's full width.
        // However, it might not be possible to fill the full width so this constraint
        // isn't required.
        solver.addConstraint(
            new kiwi.Constraint(
                widthExpression,
                kiwi.Operator.Eq,
                blockWidth,
                kiwi.Strength.medium,
            ),
        );
    }

    // Helps in tie-breaking scenarios. Try to preserve the size of each file relative
    // to each other.
    const weakerStrength = kiwi.Strength.create(0.0, 0.0, 0.5);

    for (let i = 0; i < sizeVariables.length; i++) {
        for (let j = i + 1; j < sizeVariables.length; j++) {
            const sizeVariable1 = sizeVariables[i]!;
            const sizeVariable2 = sizeVariables[j]!;

            if (sizeVariable1.actualSize < sizeVariable2.actualSize) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        sizeVariable1.width,
                        kiwi.Operator.Le,
                        sizeVariable2.width,
                        weakerStrength,
                    ),
                );
            } else if (sizeVariable1.actualSize > sizeVariable2.actualSize) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        sizeVariable1.width,
                        kiwi.Operator.Ge,
                        sizeVariable2.width,
                        weakerStrength,
                    ),
                );
            } else {
                solver.addConstraint(
                    new kiwi.Constraint(
                        sizeVariable1.width,
                        kiwi.Operator.Eq,
                        sizeVariable2.width,
                        weakerStrength,
                    ),
                );
            }
        }
    }

    solver.updateVariables();

    return sizeVariables.map(({width: widthVariable, height: heightVariable}) => {
        const width = widthVariable.value();
        const height = heightVariable.value();

        // Width in fractional units. How much should the file take as a share of the
        // entire file row's width? For more information about the `fr` unit see:
        // https://www.digitalocean.com/community/tutorials/css-css-grid-layout-fr-unit
        const widthFr =
            width / (blockWidth - contentStyles.fileRowGapWidthRem * remPx * (files.length - 1));

        return {
            width: round3(width),
            // More decimal places for `widthFr` since it's always between 0 and 1.
            widthFr: round6(widthFr),
            height: round3(height),
        };
    }) as any;
}

/**
 * Layout the file in a file float. Uses the [Cassowary algorithm][1] (specifically
 * the [`@lume/kiwi`][2] JavaScript implementation) to determine the best aesthetic
 * layout.
 *
 * [Apple's Auto Layout framework][3] for iOS and OS X development is also based on
 * the Cassowary algorithm. Which is what gives us confidence for the performance
 * of this approach.
 *
 * Layout satisfies the following constraints:
 *
 * - Must be larger than our minimum size and smaller than our maximum size
 * - Should maintain the aspect ratio of the underlying file
 * - Should have height be a multiple of a paragraph's line height so text can
 *   cleanly wrap around the file
 *
 * [1]: https://en.wikipedia.org/wiki/Cassowary_(software)
 * [2]: https://github.com/lume/kiwi
 * [3]:
 *     https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/index.html
 */
export function computeContentFileFloatLayout(
    direction: "left" | "right",
    file: FileModelData | FileEntityId | null,
    options: {
        blockWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
    },
): ContentFileLayout {
    const {blockWidth, spacingScale} = options;

    const remPx = remPxBySpacingScale[spacingScale];

    // We pass in 3 for the file count since we want to treat a floating file as if
    // it's one third of the block width at most.
    const {width, height} = getFileOrFileEntityPreviewSize(
        contentStyles.fileFloatMaxWidthAsIfFairlySplitFileCount,
        file,
        {...options, maxFileCount: contentStyles.fileFloatMaxWidthAsIfFairlySplitFileCount},
    );

    const fileFloatMaxWidth =
        (blockWidth -
            contentStyles.fileRowGapWidthRem *
                remPx *
                (contentStyles.fileFloatMaxWidthAsIfFairlySplitFileCount - 1)) /
        contentStyles.fileFloatMaxWidthAsIfFairlySplitFileCount;

    const solver = new kiwi.Solver();

    const widthVariable = new kiwi.Variable();
    const heightVariable = new kiwi.Variable();

    // Add `width` bounds. `width` should be larger than our min file size and less
    // than the file's original width (since making a small file larger will start to
    // add resize artifacts).
    //
    // The maximum width is also implicitly bound by the constraint we add below this
    // loop adding up all `widthVariables` and requiring that they're less than our
    // file row's width.
    {
        const minWidth = contentStyles.fileMinSizeRem * remPx;
        const maxWidth = width !== null ? clamp(minWidth, width, fileFloatMaxWidth) : null;

        if (minWidth === maxWidth) {
            solver.addConstraint(
                new kiwi.Constraint(
                    widthVariable,
                    kiwi.Operator.Eq,
                    minWidth,
                    kiwi.Strength.required,
                ),
            );
        } else {
            solver.addConstraint(
                new kiwi.Constraint(
                    widthVariable,
                    kiwi.Operator.Ge,
                    minWidth,
                    kiwi.Strength.required,
                ),
            );

            if (width !== null && maxWidth !== null) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Le,
                        maxWidth,
                        kiwi.Strength.required,
                    ),
                );

                // Ideally we match the file's width. But it's not required. If our width is larger
                // than the max width the solver will maximize our width variable.
                solver.addConstraint(
                    new kiwi.Constraint(widthVariable, kiwi.Operator.Eq, width, kiwi.Strength.weak),
                );
            } else {
                // If there's no `maxWidth` (because there's no `width`) then we want the file to
                // be close to a 1/3 of the block width. But it's perfectly fine to break this
                // constraint.
                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Eq,
                        fileFloatMaxWidth,
                        kiwi.Strength.weak,
                    ),
                );
            }
        }
    }

    // Add `height` bounds. `height` should be larger than our min file size and less
    // than both the file's original height (since making a small file larger will
    // start to add resize artifacts) and the file row's maximum height.
    {
        const minHeight = contentStyles.fileFloatMinHeightPx[spacingScale];
        const maxHeight = clamp(
            minHeight,
            height,
            contentStyles.fileFloatMaxHeightPx[spacingScale],
        );

        if (minHeight === maxHeight) {
            solver.addConstraint(
                new kiwi.Constraint(
                    heightVariable,
                    kiwi.Operator.Eq,
                    minHeight,
                    kiwi.Strength.required,
                ),
            );
        } else {
            solver.addConstraint(
                new kiwi.Constraint(
                    heightVariable,
                    kiwi.Operator.Ge,
                    minHeight,
                    kiwi.Strength.required,
                ),
            );

            solver.addConstraint(
                new kiwi.Constraint(
                    heightVariable,
                    kiwi.Operator.Le,
                    maxHeight,
                    kiwi.Strength.required,
                ),
            );

            // Ideally we match the file's height. But it's not required. If our height is
            // larger than the max height the solver will maximize our height variable.
            solver.addConstraint(
                new kiwi.Constraint(heightVariable, kiwi.Operator.Eq, height, kiwi.Strength.weak),
            );
        }
    }

    // Maintain the aspect ratio of the file as best we can. This constraint isn't
    // required, the solver may break it if necessary.
    solver.addConstraint(
        new kiwi.Constraint(
            widthVariable.minus(
                heightVariable.multiply(
                    clamp(
                        minFilePreviewAspectRatio,
                        (width ?? fileFloatMaxWidth) / height,
                        maxFilePreviewAspectRatio,
                    ),
                ),
            ),
            width !== null ? kiwi.Operator.Eq : kiwi.Operator.Ge,
            0,
            kiwi.Strength.strong,
        ),
    );

    solver.updateVariables();

    // Get our initial height from the solver then let's try rounding the height to the
    // nearest number of paragraph lines. By rounding the file height to paragraph
    // lines we can neatly fit our file next to text which'll flow naturally around the
    // file.
    {
        let lineCount =
            (heightVariable.value() + contentStyles.fileFloatMarginYRem * remPx * 2) /
            contentStyles.paragraphLineHeightPx[spacingScale];

        // We actually are rounding to the nearest `n + 0.7` line count (where `n` is an
        // integer) that's smaller than the original file height. We have to strike this
        // balance where the bottom margin around the file looks good in as many scenarios
        // as possible. The two main scenarios we consider are:
        //
        // 1. When there's a single full paragraph to the right of the file
        // 2. When there's two paragraphs to the right of the file
        //
        // 0.7 is the value we found through optical alignment that balances whitespace in
        // these two scenarios. [Some example images][1] of the cases we're testing.
        //
        // [1]: https://gist.github.com/calebmer/6f3d44fbc6c3748cd75db7ac9faddd13
        const lineCountRemainder = 0.7;

        lineCount = Math.floor(lineCount + (1 - lineCountRemainder)) - (1 - lineCountRemainder);

        solver.addConstraint(
            new kiwi.Constraint(
                heightVariable,
                kiwi.Operator.Eq,
                lineCount * contentStyles.paragraphLineHeightPx[spacingScale] -
                    contentStyles.fileFloatMarginYRem * remPx * 2,
                kiwi.Strength.medium,
            ),
        );
    }

    solver.updateVariables();

    return {
        width: round3(widthVariable.value()),
        widthFr: 1,
        height: round3(heightVariable.value()),
    };
}

/**
 * We treat all files as half their actual size in order to prevent up-scaling on
 * retina displays.
 *
 * A retina display is one where [`devicePixelRatio`][1] is greater than 1. Most
 * retina display's have a `devicePixelRatio` of 2. (Some newer iPhones have a
 * `devicePixelRatio` of 3.)
 *
 * The theory here is that these days enough displays are retina displays that we
 * should make sure files look crisp on retina displays and gracefully degrade on
 * non-retina displays. Additionally, we're betting that most image files are
 * optimized to look good on retina displays (since they're probably being produced
 * on retina displays).
 *
 * Basically all mobile phones have retina displays. Many monitors also have retina
 * displays.
 *
 * So to make sure a 400x300 image looks crisp on a retina display (with a
 * `devicePixelRatio` of 2) then we need to render the image at 200x150 (half the
 * original size). We apply this down-scaling constant to images so the size we use
 * for layout is the half the actual file's size.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
 */
const fileImagePreviewSizeDownScale = 2;

declare global {
    // eslint-disable-next-line no-var
    var __fileEntityPreviewSmallAspectRatio: number | undefined;
}

// In development and test environments we look for
// `__fileEntityPreviewSmallAspectRatio` which lets us fudge the aspect ratio of
// file entity previews for screenshots.
const fileEntityPreviewSmallAspectRatio =
    process.env.NODE_ENV !== "production" &&
    typeof globalThis.__fileEntityPreviewSmallAspectRatio === "number"
        ? globalThis.__fileEntityPreviewSmallAspectRatio
        : letterPaperAspectRatio;

/**
 * Get the original size of the file's preview in pixels. When laying out files
 * we'll try to preserve the width/height aspect ratio from this function. We also
 * won't grow the file to a size larger than the width/height returned by this
 * function but we will shrink files to fit in our available space if necessary.
 */
function getFileOrFileEntityPreviewSize(
    fileCount: number,
    file: FileModelData | FileEntityId | null,
    {
        maxFileCount,
        platform,
        spacingScale,
        blockWidth,
    }: {
        maxFileCount: number;
        platform: Platform;
        spacingScale: SpacingScale;
        blockWidth: number;
    },
): {
    width: number | null;
    height: number;
} {
    // The file entity width is flexible. We want it to be as near the block width as
    // possible. But the file entity's height when there's:
    //
    // - One file should be the same as `<DocumentCommentThreadPreview>`.
    // - Three files should be a height that gives a letter paper aspect ratio assuming
    //   there are two other entities in the row.
    // - Two files should be in between the height of one file and three files.
    if (typeof file === "string") {
        const maxBlockWidthPercent =
            blockWidth /
            (contentStyles.blockMaxWidthRem[platform] * remPxBySpacingScale[spacingScale]);

        const startHeight = convertRemLengthToPx(documentCommentThreadPreviewHeight, spacingScale);

        if (
            fileCount <= 1 &&
            // To better support tables, we only permit this short height if the block width is
            // at least half of the max block width.
            maxBlockWidthPercent > 1 / 2
        ) {
            return {width: null, height: startHeight};
        }

        const endHeight = blockWidth / maxFileCount / fileEntityPreviewSmallAspectRatio;

        if (
            fileCount <= 2 &&
            // To better support tables, we only permit this medium height if the block width
            // is at least a third of the max block width.
            maxBlockWidthPercent > 1 / 3
        ) {
            const middleHeight = startHeight + (endHeight - startHeight) / 2;
            return {width: null, height: middleHeight};
        }

        return {width: null, height: endHeight};
    }

    return getFilePreviewSize(file);
}

/**
 * Get the original size of the file's preview in pixels. When laying out files
 * we'll try to preserve the width/height aspect ratio from this function. We also
 * won't grow the file to a size larger than the width/height returned by this
 * function but we will shrink files to fit in our available space if necessary.
 */
export function getFilePreviewSize(file: FileModelData | null): {
    width: number;
    height: number;
} {
    if (!file?.preview) {
        return smallFallbackFileSize;
    }

    switch (file.preview.type) {
        case "Audio": {
            // Use the larger `remPx` size (mobile). The file will be scaled down as necessary.
            const width = largeFallbackFileWidth;
            const height = width / maxFilePreviewAspectRatio;
            return {width, height};
        }
        case "Code": {
            // Pick an aspect ratio that shows all 16 lines of code and a line width of almost
            // exactly 80 characters (at font size 75).
            const aspectRatio = 63 / 32;

            // Use the larger `remPx` size (mobile) and the larger block max width (mobile).
            // The file will be scaled down as necessary.
            const width = largeFallbackFileWidth;
            const height = largeFallbackFileWidth / aspectRatio;
            return {width, height};
        }
        case "Image": {
            if (file.preview.size === "Processing") return largeFallbackFileSize;
            if (file.preview.size === "Error") return smallFallbackFileSize;

            // Don't downscale SVG vector images. Since they can scale up
            const downScale =
                file.contentType === "image/svg+xml" ? 1 : fileImagePreviewSizeDownScale;

            return {
                width:
                    file.preview.size.width /
                    // Files that already are at a scale of 2 or more don't need to be downscaled. We
                    // render PDFs at 2x their actual width/height so they look good on retina displays
                    // at their proper size.
                    Math.max(downScale, file.preview.size.scale),
                height:
                    file.preview.size.height /
                    // Files that already are at a scale of 2 or more don't need to be downscaled. We
                    // render PDFs at 2x their actual width/height so they look good on retina displays
                    // at their proper size.
                    Math.max(downScale, file.preview.size.scale),
            };
        }
        default:
            throw exhaustive(file.preview);
    }
}
