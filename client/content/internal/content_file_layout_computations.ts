import * as kiwi from "@lume/kiwi";
import {contentStyles} from "~/client/styles/styles.js";
import {remPxByPlatform, screenPaddingXRem} from "~/shared/design/spacing.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * The fallback file aspect ratio we use when we don't have a way to preview
 * the file. For example binary files or files with an error message.
 */
const fallbackFileAspectRatio = 3 / 2;

// Use the larger `remPx` size (mobile) and the larger block max width
// (mobile). The file will be scaled down as necessary.
const fallbackFileWidth = contentStyles.blockMaxWidthRem.mobile * remPxByPlatform.mobile;
const fallbackFileHeight = fallbackFileWidth / fallbackFileAspectRatio;
const fallbackFileSize = {width: fallbackFileWidth, height: fallbackFileHeight};

// Round numbers to 3 decimal places so we sending less data over the
// network in our generated HTML.
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
 * Layout the files in a file row. Uses the [Cassowary algorithm][1]
 * (specifically the [`@lume/kiwi`][2] JavaScript implementation) to determine
 * the most aesthetic layout for up to three files in a row. The key constraint
 * of our layout algorithm is all files should share the same height and should
 * ideally fill our full content width all while preserving the underlying
 * files' aspect ratios.
 *
 * [Apple's Auto Layout framework][3] for iOS and OS X development is also
 * based on the Cassowary algorithm. Which is what gives us confidence for the
 * performance of this approach.
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
 * [3]: https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/index.html
 */
export function computeContentFileRowLayout<Files extends Array<FileModel | null>>(
    files: Files,
    {screenWidth, isMobile}: {screenWidth: number; isMobile: boolean},
): {[Key in keyof Files]: ContentFileLayout} {
    assert(files.length >= 1);
    assert(files.length <= 3);

    const remPx = remPxByPlatform[isMobile ? "mobile" : "desktop"];

    const solver = new kiwi.Solver();

    const sizeVariables: Array<{width: kiwi.Variable; height: kiwi.Variable}> = [];
    let firstHeightVariable: kiwi.Variable | null = null;

    for (const file of files) {
        const {width, height} = getFilePreviewSize(file);

        const widthVariable = new kiwi.Variable();
        const heightVariable = new kiwi.Variable();

        sizeVariables.push({width: widthVariable, height: heightVariable});

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
        // than the file's original width (since making a small file larger will start
        // to add resize artifacts).
        //
        // The maximum width is also implicitly bound by the constraint we add below
        // this loop adding up all `widthVariables` and requiring that they're less
        // than our file row's width.
        {
            const minWidth = contentStyles.fileMinSizeRem * remPx;
            const maxWidth = Math.max(minWidth, width);

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

                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Le,
                        maxWidth,
                        kiwi.Strength.required,
                    ),
                );
            }
        }

        // Add `height` bounds. `height` should be larger than our min file size and less
        // than both the file's original height (since making a small file larger will
        // start to add resize artifacts) and the file row's maximum height.
        {
            const minHeight = contentStyles.fileMinSizeRem * remPx;
            const maxHeight = clamp(minHeight, height, contentStyles.fileRowMaxHeightRem * remPx);

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
        }

        // Maintain the aspect ratio of the file as best we can. This constraint isn't
        // required, the solver may break it if necessary.
        solver.addConstraint(
            new kiwi.Constraint(
                widthVariable.minus(
                    heightVariable.multiply(
                        clamp(minFilePreviewAspectRatio, width / height, maxFilePreviewAspectRatio),
                    ),
                ),
                kiwi.Operator.Eq,
                0,
                kiwi.Strength.strong,
            ),
        );
    }

    const fileRowWidth = Math.min(
        contentStyles.blockMaxWidthRem[isMobile ? "mobile" : "desktop"] * remPx,
        screenWidth - screenPaddingXRem[isMobile ? "mobile" : "desktop"] * remPx * 2,
    );

    // When we add up all our widths it must be less than the total `fileRowWidth`.
    // Ideally the width is exactly equal to `fileRowWidth` but that's not possible
    // if we have smaller files.
    //
    // `fileRowWidth` is best case. We don't rerun our layout function whenever the
    // file row's width changes. Instead we hope we're taking up the full block max
    // width or we're taking the full screen on smaller devices. If the file row
    // width isn't exactly what we expect then we'll have to start cropping content
    // in the file.
    {
        let widthExpression: kiwi.Variable | kiwi.Expression = sizeVariables[0]!.width;

        for (let i = 1; i < sizeVariables.length; i++) {
            const widthVariable = sizeVariables[i]!.width;
            widthExpression = widthExpression
                .plus(contentStyles.fileRowGapWidthRem * remPx)
                .plus(widthVariable);
        }

        solver.addConstraint(
            new kiwi.Constraint(
                widthExpression,
                kiwi.Operator.Le,
                fileRowWidth,
                kiwi.Strength.required,
            ),
        );

        // We think it's most aesthetically pleasing when files fill our row's full
        // width. However, it might not be possible to fill the full width so this
        // constraint isn't required.
        solver.addConstraint(
            new kiwi.Constraint(
                widthExpression,
                kiwi.Operator.Eq,
                fileRowWidth,
                kiwi.Strength.medium,
            ),
        );
    }

    solver.updateVariables();

    return sizeVariables.map(({width: widthVariable, height: heightVariable}) => {
        const width = widthVariable.value();
        const height = heightVariable.value();

        // Width in fractional units. How much should the file take as a share of the
        // entire file row's width? For more information about the `fr` unit see:
        // https://www.digitalocean.com/community/tutorials/css-css-grid-layout-fr-unit
        const widthFr =
            width / (fileRowWidth - contentStyles.fileRowGapWidthRem * remPx * (files.length - 1));

        return {
            width: round3(width),
            // More decimal places for `widthFr` since it's always between 0 and 1.
            widthFr: round6(widthFr),
            height: round3(height),
        };
    }) as any;
}

/**
 * Layout the file in a file float. Uses the [Cassowary algorithm][1]
 * (specifically the [`@lume/kiwi`][2] JavaScript implementation) to determine
 * the best aesthetic layout.
 *
 * [Apple's Auto Layout framework][3] for iOS and OS X development is also
 * based on the Cassowary algorithm. Which is what gives us confidence for the
 * performance of this approach.
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
 * [3]: https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/index.html
 */
export function computeContentFileFloatLayout(
    direction: "left" | "right",
    file: FileModel | null,
    {screenWidth, isMobile}: {screenWidth: number; isMobile: boolean},
): ContentFileLayout {
    const remPx = remPxByPlatform[isMobile ? "mobile" : "desktop"];
    const {width, height} = getFilePreviewSize(file);

    const fileFloatMaxWidth = Math.round(
        Math.min(
            contentStyles.blockMaxWidthRem[isMobile ? "mobile" : "desktop"] * remPx,
            screenWidth - screenPaddingXRem[isMobile ? "mobile" : "desktop"] * remPx * 2,
        ) * contentStyles.fileFloatMaxWidthPercent,
    );

    const solver = new kiwi.Solver();

    const widthVariable = new kiwi.Variable();
    const heightVariable = new kiwi.Variable();

    // Add `width` bounds. `width` should be larger than our min file size and less
    // than the file's original width (since making a small file larger will start
    // to add resize artifacts).
    //
    // The maximum width is also implicitly bound by the constraint we add below
    // this loop adding up all `widthVariables` and requiring that they're less
    // than our file row's width.
    {
        const minWidth = contentStyles.fileMinSizeRem * remPx;
        const maxWidth = clamp(minWidth, width, fileFloatMaxWidth);

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

            solver.addConstraint(
                new kiwi.Constraint(
                    widthVariable,
                    kiwi.Operator.Le,
                    maxWidth,
                    kiwi.Strength.required,
                ),
            );

            // Ideally we match the file's width. But it's not required. If our width is
            // larger than the max width the solver will maximize our width variable.
            solver.addConstraint(
                new kiwi.Constraint(widthVariable, kiwi.Operator.Eq, width, kiwi.Strength.weak),
            );
        }
    }

    // Add `height` bounds. `height` should be larger than our min file size and less
    // than both the file's original height (since making a small file larger will
    // start to add resize artifacts) and the file row's maximum height.
    {
        const minHeight = contentStyles.fileFloatMinHeightRem * remPx;
        const maxHeight = clamp(minHeight, height, contentStyles.fileRowMaxHeightRem * remPx);

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
                    clamp(minFilePreviewAspectRatio, width / height, maxFilePreviewAspectRatio),
                ),
            ),
            kiwi.Operator.Eq,
            0,
            kiwi.Strength.strong,
        ),
    );

    solver.updateVariables();

    // Get our initial height from the solver then let's try rounding the height to
    // the nearest number of paragraph lines. By rounding the file height to
    // paragraph lines we can neatly fit our file next to text which'll flow
    // naturally around the file.
    {
        let lineCount =
            (heightVariable.value() + contentStyles.fileFloatMarginYRem * remPx * 2) /
            (contentStyles.paragraphLineHeightRem * remPx);

        // We actually are rounding to the nearest `n + 0.7` line count (where `n` is
        // an integer) that's smaller than the original file height. We have to strike
        // this balance where the bottom margin around the file looks good in as many
        // scenarios as possible. The two main scenarios we consider are:
        //
        // 1. When there's a single full paragraph to the right of the file
        // 2. When there's two paragraphs to the right of the file
        //
        // 0.7 is the value we found through optical alignment that balances whitespace
        // in these two scenarios. [Some example images][1] of the cases we're testing.
        //
        // [1]: https://gist.github.com/calebmer/6f3d44fbc6c3748cd75db7ac9faddd13
        const lineCountRemainder = 0.7;

        lineCount = Math.floor(lineCount + (1 - lineCountRemainder)) - (1 - lineCountRemainder);

        solver.addConstraint(
            new kiwi.Constraint(
                heightVariable,
                kiwi.Operator.Eq,
                lineCount * (contentStyles.paragraphLineHeightRem * remPx) -
                    contentStyles.fileFloatMarginYRem * remPx * 2,
                kiwi.Strength.medium,
            ),
        );
    }

    solver.updateVariables();

    const widthSolution =
        widthVariable.value() +
        (direction === "left"
            ? contentStyles.fileFloatLeftMarginXRem
            : contentStyles.fileFloatRightMarginXRem) *
            remPx;

    const heightSolution = heightVariable.value() + contentStyles.fileFloatMarginYRem * remPx * 2;

    return {
        width: round3(widthSolution),
        widthFr: 1,
        height: round3(heightSolution),
    };
}

/**
 * We treat all files as half their actual size in order to prevent up-scaling
 * on retina displays.
 *
 * A retina display is one where [`devicePixelRatio`][1] is greater than 1.
 * Most retina display's have a `devicePixelRatio` of 2. (Some newer iPhones
 * have a `devicePixelRatio` of 3.)
 *
 * The theory here is that these days enough displays are retina displays that
 * we should make sure files look crisp on retina displays and gracefully
 * degrade on non-retina displays. Additionally, we're betting that most image
 * files are optimized to look good on retina displays (since they're probably
 * being produced on retina displays).
 *
 * Basically all mobile phones have retina displays. Many monitors also have
 * retina displays.
 *
 * So to make sure a 400x300 image looks crisp on a retina display (with a
 * `devicePixelRatio` of 2) then we need to render the image at 200x150 (half
 * the original size). We apply this down-scaling constant to images so the
 * size we use for layout is the half the actual file's size.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
 */
const fileImagePreviewSizeDownScale = 2;

/**
 * Get the original size of the file's preview in pixels. When laying out files
 * we'll try to preserve the width/height aspect ratio from this function. We
 * also won't grow the file to a size larger than the width/height returned by
 * this function but we will shrink files to fit in our available space if
 * necessary.
 */
export function getFilePreviewSize(file: FileModel | null): {width: number; height: number} {
    if (!file?.preview) {
        return fallbackFileSize;
    }

    switch (file.preview.type) {
        case "Audio": {
            // Same aspect ratio as an [Ultrawide monitor][1]. Which is about the widest
            // aspect ratio we allow. We need some wide space to render an audio player.
            //
            // [1]: https://en.wikipedia.org/wiki/Ultrawide_formats
            const aspectRatio = 21 / 9;

            // Use the larger `remPx` size (mobile). The file will be scaled down as
            // necessary.
            const height = contentStyles.fileMinSizeRem * remPxByPlatform.mobile;
            const width = height * aspectRatio;
            return {width, height};
        }
        case "Code": {
            // Pick an aspect ratio that shows all 16 lines of code and a line width of
            // almost exactly 80 characters (at font size 75).
            const aspectRatio = 63 / 32;

            // Use the larger `remPx` size (mobile) and the larger block max width
            // (mobile). The file will be scaled down as necessary.
            const width = fallbackFileWidth;
            const height = fallbackFileWidth / aspectRatio;
            return {width, height};
        }
        case "Image": {
            if (file.preview.size === "Processing" || file.preview.size === "Error") {
                return fallbackFileSize;
            }

            return {
                width:
                    file.preview.size.width /
                    // Files that already are at a scale of 2 or more don't need to be downscaled.
                    // We render PDFs at 2x their actual width/height so they look good on retina
                    // displays at their proper size.
                    Math.max(fileImagePreviewSizeDownScale, file.preview.size.scale),
                height:
                    file.preview.size.height /
                    // Files that already are at a scale of 2 or more don't need to be downscaled.
                    // We render PDFs at 2x their actual width/height so they look good on retina
                    // displays at their proper size.
                    Math.max(fileImagePreviewSizeDownScale, file.preview.size.scale),
            };
        }
        default:
            throw exhaustive(file.preview);
    }
}
