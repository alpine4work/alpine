import classNames from "classnames";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_widths.js";
import {FontSize, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";

type transformScaleBaseFontSize = Extract<FontSize, "75" | "100">;

export interface ContentFileEntityPreviewContainerOptions {
    layout: ContentFileLayout;
    platform: Platform;
    spacingScale: SpacingScale;
    transformScaleBaseFontSize: transformScaleBaseFontSize;
    withoutContainerPaddingY?: boolean;
    scaledContainerClassName?: string;
    scaledContainerStyles?: Array<string>;
    calculateScaledContainerTransformStyle?: (config: {
        transformScale: number;
        paddingPx: number;
        scaledWidthPx: number;
        blockMaxWidthPx: number;
    }) => string;
}

export interface ContentFileEntityPreviewContainerResult {
    scaledContainerHtml: HtmlElementGenerator;
    transformScale: number;
    scaledWidthPx: number;
    blockMaxWidthPx: number;
    isSmallerThanHalfOfBlockMaxWidth: boolean;
    isSmallerThanThirdOfBlockMaxWidth: boolean;
    containerPaddingPx: number;
}

export function setupContentFileEntityPreviewContainer(
    html: HtmlElementGenerator,
    config: ContentFileEntityPreviewContainerOptions,
): ContentFileEntityPreviewContainerResult {
    const {layout, platform, spacingScale} = config;

    const remPx = remPxBySpacingScale[spacingScale];
    const blockMaxWidthPx = contentStyles.blockMaxWidthRem[platform] * remPx;

    const isSmallerThanHalfOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx) / 2;

    const isSmallerThanThirdOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx * 2) / 3;

    const isSmallerThanFourthOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx * 3) / 4;

    const containerPadding = isSmallerThanFourthOfBlockMaxWidth
        ? "2"
        : isSmallerThanThirdOfBlockMaxWidth
          ? "3"
          : isSmallerThanHalfOfBlockMaxWidth
            ? "4"
            : "5";

    const transformScale =
        (isSmallerThanFourthOfBlockMaxWidth
            ? fontSizesBySpacingScale["50"].small.fontSize / 2
            : fontSizesBySpacingScale[
                  isSmallerThanThirdOfBlockMaxWidth
                      ? "50"
                      : isSmallerThanHalfOfBlockMaxWidth
                        ? "75"
                        : config.transformScaleBaseFontSize
              ].small.fontSize) / fontSizesBySpacingScale["100"].small.fontSize;

    const containerHtml = html.appendChild(new HtmlElementGenerator("div"));
    // To Discuss: Making an assumption here about why document only used paddingX vs.
    // padding
    const containerPaddingClass = config.withoutContainerPaddingY
        ? sprinkles({paddingX: containerPadding})
        : sprinkles({padding: containerPadding});
    containerHtml.setAttribute(
        "class",
        classNames(containerHtml.getAttribute("class"), containerPaddingClass),
    );

    const containerPaddingPx = parseRemLength(containerPadding) * remPx;
    const scaledWidthPx = (layout.width - containerPaddingPx * 2) / transformScale;

    const scaledContainerHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));
    {
        const existingClass = scaledContainerHtml.getAttribute("class");
        if (config.scaledContainerClassName) {
            scaledContainerHtml.setAttribute(
                "class",
                classNames(existingClass, config.scaledContainerClassName),
            );
        }
        // Get transform - use callback if provided, otherwise default to simple scale
        const transform = config.calculateScaledContainerTransformStyle
            ? config.calculateScaledContainerTransformStyle({
                  transformScale,
                  paddingPx: containerPaddingPx,
                  scaledWidthPx,
                  blockMaxWidthPx,
              })
            : `scale(${transformScale})`;

        // Apply base styling that all previews need
        const commonScaledContainerStyles = [
            `transform: ${transform}`,
            "transform-origin: 0 0",
            `width: ${scaledWidthPx}px`,
            `min-width: 100%`,
        ];
        const scaledContainerStyles = [
            ...commonScaledContainerStyles,
            ...(config.scaledContainerStyles ?? []),
        ];
        scaledContainerHtml.setAttribute("style", scaledContainerStyles.join("; "));
    }

    return {
        scaledContainerHtml,
        transformScale,
        scaledWidthPx,
        blockMaxWidthPx,
        isSmallerThanHalfOfBlockMaxWidth,
        isSmallerThanThirdOfBlockMaxWidth,
        containerPaddingPx,
    };
}
