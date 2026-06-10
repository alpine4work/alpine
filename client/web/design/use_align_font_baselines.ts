import {useMemo} from "react";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {backgroundFontSizePercentage} from "~/client/web/styles/styles.js";
import {interFontAscender, interFontDescender} from "~/shared/design/core/font_metrics.js";
import {FontSize, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";

/**
 * Gives a number (in pixels) which when offsetting `thisFontSize` will align it
 * with `otherFontSize`. You can use this pixel value with `margin-top: n` or
 * `position: relative; top: n` for example.
 */
export function useAlignFontBaselines(thisFontSize: FontSize, otherFontSize: FontSize): number {
    const spacingScale = useSpacingScale();

    return useMemo(() => {
        const otherFontSizeObject = fontSizesBySpacingScale[otherFontSize][spacingScale];

        const otherFontSizeDescender =
            otherFontSizeObject.fontSize *
            (backgroundFontSizePercentage - 1) *
            (interFontDescender / (interFontAscender + interFontDescender));

        const otherFontSizeBottomHalfHeight =
            otherFontSizeDescender + otherFontSizeObject.fontSize / 2;

        const thisFontSizeObject = fontSizesBySpacingScale[thisFontSize][spacingScale];

        const thisFontSizeDescender =
            thisFontSizeObject.fontSize *
            (backgroundFontSizePercentage - 1) *
            (interFontDescender / (interFontAscender + interFontDescender));

        const thisFontSizeBottomHalfHeight =
            thisFontSizeDescender + thisFontSizeObject.fontSize / 2;

        return -thisFontSizeBottomHalfHeight + otherFontSizeBottomHalfHeight;
    }, [otherFontSize, spacingScale, thisFontSize]);
}
