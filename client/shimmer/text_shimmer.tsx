import {Box} from "~/client/design/box.js";
import {
    RemLength,
    Spacing,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
} from "~/shared/design/spacing.js";
import {
    Sprinkles,
    fontSizes,
    fontSizesByPlatform,
    pulseAnimationClassName,
} from "~/shared/styles/styles.js";

const textShimmerFontSizePercentage =
    (parseRemLengthNumber(spacing["3"]) * remPxByPlatform.desktop) /
    fontSizesByPlatform["100"].desktop.fontSize;

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
    fontSize: keyof typeof fontSizes | {readonly fontSize: string; readonly lineHeight: RemLength};
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
