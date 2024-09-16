import * as kiwi from "@lume/kiwi";
import {contentStyles} from "~/client/styles/styles.js";
import {remPxByPlatform, screenPaddingXRem} from "~/shared/design/spacing.js";
import {FileModel} from "~/shared/files/file_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * The minimum width:height aspect ratio we support when rendering images.
 * Images with a taller aspect ratio will be cropped. Super tall images start
 * to look bad with our layout engine since either they take over the page
 * (forcing you to scroll) or if we want to keep images to a max height we'd
 * have to start shrinking the image until there's barely any visible width
 * remaining. So instead we limit how tall images can get before we start
 * cropping.
 *
 * Three tall aspect ratios we want to support without cropping:
 *
 * 1. Large phones. The [largest iPhone is 9:19.5][1] (~0.46) which is greater
 *    than 21:50 (0.42). We don't want to crop iPhone screenshots.
 *
 * 2. [Ultrawide 21:9 (~0.43) monitors][2]. In case a user has turned their
 *    monitor vertically and took a screenshot. We don't want to crop that
 *    screenshot.
 *
 * 3. The [standard for "Big Screen Cinema" (Cinemascope) is 2.35:1][3]
 *    (1:2.35 is ~0.43). While it's unlikely someone would rotate a cinema shot
 *    vertically, we use the inverse of our minimum aspect ratio as our maximum
 *    aspect ratio. So we want to make sure a cinema shot works horizontally
 *    without being cropped.
 *
 * We picked 21:50 to just barely include Ultrawide monitors. We could do 2:5
 * which is simpler but we may already be pushing the limits of what can look
 * good visually with 21:50.
 *
 * [1]: https://iosref.com/res#iphone
 * [2]: https://en.wikipedia.org/wiki/Ultrawide_formats
 * [3]: https://elitescreens.com/understanding-aspect-ratio
 */
const minFileAspectRatio = 21 / 50;

/**
 * The maximum width:height aspect ratio we support when rendering images.
 * Images with a wider aspect ratio will be cropped. Super wide image start to
 * look bad with our layout engine since they start shrinking (to stay within
 * the document's bounds) until there's barely any visible height.
 *
 * It's the inverse of `minFileAspectRatio`. Wider images may look better than
 * taller images so we could consider increasing this if there's a good use
 * case.
 */
const maxFileAspectRatio = minFileAspectRatio ** -1;

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
 * [1]: https://en.wikipedia.org/wiki/Cassowary_(software)
 * [2]: https://github.com/lume/kiwi
 * [3]: https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/index.html
 */
export function layoutContentFileRow<Files extends Array<FileModel | null>>(
    files: Files,
    {screenWidth, isMobile}: {screenWidth: number; isMobile: boolean},
): {[Key in keyof Files]: {width: number; widthFr: number; height: number}} {
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
            const maxHeight = clamp(minHeight, height, contentStyles.fileMaxHeightRem * remPx);

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
                        clamp(minFileAspectRatio, width / height, maxFileAspectRatio),
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
            width,
            widthFr,
            height,
        };
    }) as any;
}

/**
 * Get the original size of the file's preview in pixels. When laying out files
 * we'll try to preserve the width/height aspect ratio from this function. We
 * also won't grow the file to a size larger than the width/height returned by
 * this function but we will shrink files to fit in our available space if
 * necessary.
 */
function getFilePreviewSize(file: FileModel | null): {width: number; height: number} {
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
            // Standard laptop monitor aspect ratio. As if you rendered the code file
            // fullscreen on your laptop.
            // https://www.theverge.com/2021/1/19/22238671
            const aspectRatio = 3 / 2;

            // Use the larger `remPx` size (mobile) and the larger block max width
            // (mobile). The file will be scaled down as necessary.
            const width = contentStyles.blockMaxWidthRem.mobile * remPxByPlatform.mobile;
            const height = fallbackFileWidth / aspectRatio;
            return {width, height};
        }
        case "Image": {
            if (
                (!file.preview.isProcessing && !file.preview.ok) ||
                file.preview.size === "Processing"
            ) {
                return fallbackFileSize;
            }

            return {
                width: file.preview.size.width / file.preview.size.scale,
                height: file.preview.size.height / file.preview.size.scale,
            };
        }
        default:
            throw exhaustive(file.preview);
    }
}
