import {Box} from "~/client/design/box.js";
import {Sprinkles, fontSizes, pulseAnimationClassName} from "~/client/styles/styles.js";
import {FontSize, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {RemLength, Spacing, parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

const textShimmerFontSizePercentage =
    (parseRemLength("3") * remPxBySpacingScale.medium) /
    fontSizesBySpacingScale["100"].medium.fontSize;

export function TextShimmer({
    width,
    color = "grey-5",
    ragRight,
    fontSize,
}: {
    width: Sprinkles["maxWidth"];
    color?: "grey-5" | "grey-10";
    // Helps create a "ragged edge" for text which may otherwise have the
    // same width.
    ragRight?: Spacing;
    fontSize: FontSize | {readonly fontSize: string; readonly lineHeight: RemLength};
}) {
    fontSize = typeof fontSize === "string" ? fontSizes[fontSize] : fontSize;

    return (
        <Box
            maxWidth={width}
            width="full"
            paddingRight={ragRight}
            display="flex"
            alignItems="center"
            style={{height: fontSize.lineHeight}}
        >
            <Box
                className={pulseAnimationClassName}
                width="full"
                backgroundColor={color}
                borderRadius="full"
                style={{height: `calc(${fontSize.fontSize} * ${textShimmerFontSizePercentage})`}}
            />
        </Box>
    );
}
