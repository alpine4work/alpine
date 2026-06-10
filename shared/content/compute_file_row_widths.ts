import * as kiwi from "@lume/kiwi";
import {
    contentBlockMaxWidthRem,
    contentFileMinSizeRem,
    contentFileRowGapWidthRem,
    contentFileRowMaxHeightRem,
} from "~/shared/design/core/content_shared_styles.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * The minimum width:height aspect ratio we support when rendering images. Images
 * with a taller aspect ratio will be cropped. Super tall images start to look bad
 * with our layout engine since either they take over the page (forcing you to
 * scroll) or if we want to keep images to a max height we'd have to start
 * shrinking the image until there's barely any visible width remaining. So instead
 * we limit how tall images can get before we start cropping.
 *
 * Three tall aspect ratios we want to support without cropping:
 *
 * 1. Large phones. The [largest iPhone is 9:19.5][1] (~0.46) which is greater than
 *    21:50 (0.42). We don't want to crop iPhone screenshots.
 *
 * 2. [Ultrawide 21:9 (~0.43) monitors][2]. In case a user has turned their monitor
 *    vertically and took a screenshot. We don't want to crop that screenshot.
 *
 * 3. The [standard for "Big Screen Cinema" (Cinemascope) is 2.35:1][3] (1:2.35 is
 *    ~0.43). While it's unlikely someone would rotate a cinema shot vertically, we
 *    use the inverse of our minimum aspect ratio as our maximum aspect ratio. So
 *    we want to make sure a cinema shot works horizontally without being cropped.
 *
 * 4. Paper print outs. [Letter paper aspect ratio is 17:22][4] (~0.77) which is
 *    greater than 0.42 so letter paper doesn't crop.
 *
 * We picked 21:50 to just barely include Ultrawide monitors. We could do 2:5 which
 * is simpler but we may already be pushing the limits of what can look good
 * visually with 21:50.
 *
 * [1]: https://iosref.com/res#iphone
 * [2]: https://en.wikipedia.org/wiki/Ultrawide_formats
 * [3]: https://elitescreens.com/understanding-aspect-ratio
 * [4]: https://en.wikipedia.org/wiki/Letter_(paper_size)
 */
export const minAspectRatioIfNotSingleFileRow = 21 / 50;

const maxAspectRatioIfNotSingleFileRow = minAspectRatioIfNotSingleFileRow ** -1;

/**
 * The default block width in pixels for file layout. Matches the desktop platform
 * at the small spacing scale:
 * `contentBlockMaxWidthRem.desktop * remPxBySpacingScale.small`.
 *
 * Specifically we depend on this being 600px on desktop. If you adjust content
 * width or screen padding, consider also adjusting file preview image resize
 * widths. See `content.css.ts` for the canonical definition.
 */
export const fileRowBlockWidthPxForServerAndClipboard =
    contentBlockMaxWidthRem.desktop * remPxBySpacingScale.small;

/**
 * The default height in pixels for file entity previews (e.g. embedded documents,
 * channels) in the layout. Matches `documentCommentThreadPreviewHeight` (spacing
 * "48" = 12rem) at the small spacing scale.
 */
export const fileRowDefaultPreviewHeightPx =
    parseRemLength(spacing["48"]) * remPxBySpacingScale.small;

/**
 * Maximum number of items we lay out in a single file row.
 */
export const fileRowMaxFileCount = 3;

// Round numbers to 3 decimal places so we send less data over the network in our
// generated HTML.
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
 * This is the core layout algorithm shared between the client-side renderer and
 * the API content layer. Client code supplies platform-specific min/max sizes; the
 * API layer can use simpler defaults.
 *
 * Layout satisfies the following constraints:
 *
 * - Must be larger than our minimum size and smaller than our maximum size
 * - Must have the same height across all files in the row
 * - Should maintain the aspect ratio of the underlying files
 * - Should have the file widths add up to the container width
 *
 * [1]: https://en.wikipedia.org/wiki/Cassowary_(software)
 * [2]: https://github.com/lume/kiwi
 * [3]:
 *     https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/index.html
 */
export function computeFileRowLayout(
    files: ReadonlyArray<{width: number | null; height: number}>,
    options: {
        containerWidth: number;
        spacingScale: SpacingScale;
        maxHeight?: number;
    },
): ReadonlyArray<ContentFileLayout> {
    assert(files.length >= 1);
    assert(files.length <= fileRowMaxFileCount);

    const {containerWidth, spacingScale} = options;
    const remPx = remPxBySpacingScale[spacingScale];
    const gapWidth = contentFileRowGapWidthRem * remPx;
    const minElementWidth = contentFileMinSizeRem * remPx;
    const minHeight = contentFileMinSizeRem * remPx;
    const maxHeight = options.maxHeight ?? contentFileRowMaxHeightRem * remPx;

    const totalGapWidth = gapWidth * (files.length - 1);
    const availableWidth = containerWidth - totalGapWidth;
    const fairlySplitWidth = availableWidth / files.length;

    const solver = new kiwi.Solver();

    const sizeVariables: Array<{
        width: kiwi.Variable;
        height: kiwi.Variable;
        actualSize: number;
    }> = [];
    let firstHeightVariable: kiwi.Variable | null = null;

    for (const file of files) {
        const widthVariable = new kiwi.Variable();
        const heightVariable = new kiwi.Variable();

        sizeVariables.push({
            width: widthVariable,
            height: heightVariable,
            // If `width` isn't set then assume `width` as close to an even share of the
            // container width.
            actualSize: (file.width ?? fairlySplitWidth) * file.height,
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

        // If there's only one file then we want the file to fill the entire row width.
        // We'll use a letterboxed design to make sure the entire file is visible.
        if (files.length === 1) {
            solver.addConstraint(
                new kiwi.Constraint(
                    widthVariable,
                    kiwi.Operator.Eq,
                    containerWidth,
                    kiwi.Strength.required,
                ),
            );
        }
        // Add `width` bounds. `width` should be larger than our min file size.
        //
        // The maximum width is also implicitly bound by the constraint we add below this
        // loop adding up all `widthVariables` and requiring that they're less than our
        // container width.
        else {
            if (minElementWidth > 0) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Ge,
                        minElementWidth,
                        kiwi.Strength.required,
                    ),
                );
            }

            // If there's no `width` then we want the file to be close to a fair share of the
            // container width. But it's perfectly fine to break this constraint.
            if (file.width === null) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        widthVariable,
                        kiwi.Operator.Eq,
                        fairlySplitWidth,
                        kiwi.Strength.weak,
                    ),
                );
            }
        }

        // Add `height` bounds. `height` should be larger than our min height and less than
        // both the file's original height (since making a small file larger will start to
        // add resize artifacts) and the maximum height.
        {
            const clampedMaxHeight = clamp(minHeight, file.height, maxHeight);

            if (minHeight === clampedMaxHeight) {
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
                        clampedMaxHeight,
                        kiwi.Strength.required,
                    ),
                );
            }

            // If there's no width then we want the file's height to be as close to the
            // declared height as possible.
            if (file.width === null) {
                solver.addConstraint(
                    new kiwi.Constraint(
                        heightVariable,
                        kiwi.Operator.Eq,
                        file.height,
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
        const aspectRatio = (file.width ?? fairlySplitWidth) / file.height;

        solver.addConstraint(
            new kiwi.Constraint(
                widthVariable.minus(
                    heightVariable.multiply(
                        // If there's only one file in the row then we try to reach its aspect ratio since
                        // it won't cause other files in the row to be squished. This is mostly for very
                        // wide files allowing them to be fully visible without letterboxing.
                        files.length === 1
                            ? aspectRatio
                            : clamp(
                                  minAspectRatioIfNotSingleFileRow,
                                  aspectRatio,
                                  maxAspectRatioIfNotSingleFileRow,
                              ),
                    ),
                ),
                file.width !== null ? kiwi.Operator.Eq : kiwi.Operator.Ge,
                0,
                kiwi.Strength.strong,
            ),
        );
    }

    // When we add up all our widths it must equal the total container width. Ideally
    // the width is exactly equal to the container width but that's not possible if we
    // have smaller files.
    if (files.length > 1) {
        let widthExpression: kiwi.Variable | kiwi.Expression = sizeVariables[0]!.width;

        for (let i = 1; i < sizeVariables.length; i++) {
            const widthVariable = sizeVariables[i]!.width;
            widthExpression = widthExpression.plus(gapWidth).plus(widthVariable);
        }

        // Strength that's stronger than `kiwi.Strength.strong` but still isn't required.
        const strongerStrength = kiwi.Strength.create(2.0, 0.0, 0.0);

        // We think it's most aesthetically pleasing when files fill our row's full width.
        //
        // If all the files in the row were `minElementWidth` and still wouldn't fit in the
        // container then we relax the constraint so the solver can underfill the row
        // instead of failing. This only kicks in for recursive document file entities
        // which end up rendering documents at a very small size.
        const widthSumBreakable = containerWidth < minElementWidth * files.length + totalGapWidth;
        solver.addConstraint(
            new kiwi.Constraint(
                widthExpression,
                kiwi.Operator.Eq,
                containerWidth,
                widthSumBreakable ? strongerStrength : kiwi.Strength.required,
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
        // entire row's width? For more information about the `fr` unit see:
        // https://www.digitalocean.com/community/tutorials/css-css-grid-layout-fr-unit
        const widthFr = width / availableWidth;

        return {
            width: round3(width),
            // More decimal places for `widthFr` since it's always between 0 and 1.
            widthFr: round6(widthFr),
            height: round3(height),
        };
    });
}

/**
 * Compute fractional widths (0 to 1) for elements in a file row.
 *
 * Convenience wrapper around `computeFileRowLayout` that returns just the
 * fractional widths (summing to exactly 1 in 64-bit floats) for use in the API
 * content layer. The last width is computed as `1 - sumOfPreviousWidths` to
 * guarantee the values sum to exactly 1.
 */
export function computeFileRowWidths(
    files: ReadonlyArray<{width: number | null; height: number}>,
    options: {
        containerWidth: number;
        spacingScale?: SpacingScale;
    },
): Array<number> {
    const layouts = computeFileRowLayout(files, {
        containerWidth: options.containerWidth,
        spacingScale: options.spacingScale ?? "small",
    });
    const widths = layouts.map(l => round6(l.widthFr));

    // Ensure widths sum to exactly 1 by deriving the last value from the rest. This
    // avoids floating point drift from rounding each value independently.
    if (widths.length > 0) {
        let sum = 0;
        for (let i = 0; i < widths.length - 1; i++) {
            sum += widths[i]!;
        }
        widths[widths.length - 1] = round6(1 - sum);
    }

    return widths;
}
