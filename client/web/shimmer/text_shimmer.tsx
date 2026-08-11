import {useId, useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {Sprinkles, fontSizes, pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {FontSize, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Spacing, parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";

const textShimmerFontSizePercentage =
    (parseRemLength("3") * remPxBySpacingScale.small) /
    fontSizesBySpacingScale["100"].small.fontSize;

const randomTextShimmerRagRights: ReadonlyArray<Spacing> = [
    // 1x frequency
    "0",
    "1",
    "2",
    "3",
    // 3x frequency
    "4",
    "4",
    "4",
    // 1x frequency
    "5",
    "6",
    "7",
    // 3x frequency
    "8",
    "8",
    "8",
];

export function TextShimmer({
    width,
    color = "grey-5",
    ragRight: ragRightProp,
    fontSize,
    withoutPulseAnimation = false,
}: {
    width: Sprinkles["maxWidth"];
    color?: "grey-5" | "grey-10";
    // Helps create a "ragged edge" for text which may otherwise have the same width.
    ragRight?: Spacing | "random";
    fontSize: FontSize | {readonly fontSize: string; readonly lineHeight: string};
    withoutPulseAnimation?: boolean;
}) {
    const id = useId();

    fontSize = typeof fontSize === "string" ? fontSizes[fontSize] : fontSize;

    const ragRight = useMemo(() => {
        if (ragRightProp !== "random") return ragRightProp;

        const stableRandom = new StableRandom("TextShimmer:ragRight");

        return randomTextShimmerRagRights[
            stableRandom.randomInteger(id, 0, 0, randomTextShimmerRagRights.length)
        ];
    }, [id, ragRightProp]);

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
                className={!withoutPulseAnimation ? pulseAnimationClassName : undefined}
                width="full"
                backgroundColor={color}
                borderRadius="full"
                style={{height: `calc(${fontSize.fontSize} * ${textShimmerFontSizePercentage})`}}
            />
        </Box>
    );
}
