import * as kiwi from "@lume/kiwi";
import {documentCommentThreadPreviewHeight} from "~/client/web/styles/document_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {
    type ContentFileLayout,
    computeFileRowLayout,
    fileRowMaxFileCount,
    minAspectRatioIfNotSingleFileRow,
} from "~/shared/content/compute_file_row_widths.js";
import {getFileEntityPreviewHeight} from "~/shared/content/get_file_entity_preview_height.js";
import {getFilePreviewSize} from "~/shared/content/get_file_preview_size.js";

import {Platform} from "~/shared/design/core/platform.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

// Aspect ratio of letter paper. https://en.wikipedia.org/wiki/Letter_(paper_size)
const letterPaperAspectRatio = 17 / 22;

/**
 * The maximum width:height aspect ratio we support when rendering images. Images
 * with a wider aspect ratio will be cropped. Super wide image start to look bad
 * with our layout engine since they start shrinking (to stay within the document's
 * bounds) until there's barely any visible height.
 *
 * It's the inverse of `minAspectRatioIfNotSingleFileRow`. Wider images may look
 * better than taller images so we could consider increasing this if there's a good
 * use case.
 */
const maxAspectRatioIfNotSingleFileRow = minAspectRatioIfNotSingleFileRow ** -1;

// Round numbers to 3 decimal places so we sending less data over the network in
// our generated HTML.
function round3(n: number) {
    return Math.round(n * 10 ** 3) / 10 ** 3;
}

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
export function computeContentFileRowLikeLayout(
    files: Array<FileModelData | FileEntityId | null>,
    options: {
        maxFileCount: number;
        blockWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
        maxHeight?: RemLength;
    },
): ReadonlyArray<ContentFileLayout> {
    assert(files.length >= 1);
    assert(files.length <= fileRowMaxFileCount);

    const {blockWidth, spacingScale} = options;

    // Resolve file dimensions from FileModelData/FileEntityId.
    const fileSizes = files.map(file =>
        getFileOrFileEntityPreviewSize(files.length, file, options),
    );

    return computeFileRowLayout(fileSizes, {
        containerWidth: blockWidth,
        spacingScale,
        maxHeight: options.maxHeight
            ? convertRemLengthToPx(options.maxHeight, spacingScale)
            : undefined,
    });
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
                        minAspectRatioIfNotSingleFileRow,
                        (width ?? fileFloatMaxWidth) / height,
                        maxAspectRatioIfNotSingleFileRow,
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

        // To better support tables, when the block width is narrow we skip the shorter
        // 1-file/2-file heights and fall through to the compact 3-file height instead.
        let effectiveFileCount = fileCount;
        if (maxBlockWidthPercent <= 1 / 2) {
            effectiveFileCount = Math.max(effectiveFileCount, 2);
        }
        if (maxBlockWidthPercent <= 1 / 3) {
            effectiveFileCount = Math.max(effectiveFileCount, 3);
        }

        const height = getFileEntityPreviewHeight({
            fileCount: effectiveFileCount,
            maxFileCount,
            blockWidth,
            defaultPreviewHeight: convertRemLengthToPx(
                documentCommentThreadPreviewHeight,
                spacingScale,
            ),
            aspectRatio: fileEntityPreviewSmallAspectRatio,
        });

        return {width: null, height};
    }

    return getFilePreviewSize(file);
}
