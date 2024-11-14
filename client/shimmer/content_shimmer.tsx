import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const contentParagraphShimmerFontSize = mapObjectValues(
    contentStyles.paragraphFontSize,
    paragraphFontSize =>
        ({
            ...fontSizes["50"],
            lineHeight: paragraphFontSize.lineHeight,
        } as const),
);

export function ContentParagraphShimmer1() {
    const spacingScale = useSpacingScale();

    return (
        <>
            <TextShimmer
                width="full"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                ragRight="12"
            />
            <TextShimmer
                width="full"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                ragRight="4"
            />
            <TextShimmer
                width="64"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                // So when screen shrinks last line isn't longer than other lines with
                // `ragRight`.
                ragRight="20"
            />
        </>
    );
}

export function ContentParagraphShimmer2() {
    const spacingScale = useSpacingScale();

    return (
        <>
            <TextShimmer
                width="full"
                ragRight="16"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
            />
            <TextShimmer
                width="128"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                // So when screen shrinks last line isn't longer than other lines with
                // `ragRight`.
                ragRight="20"
            />
        </>
    );
}

export function ContentParagraphShimmer3() {
    const spacingScale = useSpacingScale();

    return (
        <>
            <TextShimmer
                width="full"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                ragRight="8"
            />
            <TextShimmer
                width="full"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                ragRight="2"
            />
            <TextShimmer
                width="full"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                ragRight="16"
            />
            <TextShimmer
                width="48"
                fontSize={contentParagraphShimmerFontSize[spacingScale]}
                // So when screen shrinks last line isn't longer than other lines with
                // `ragRight`.
                ragRight="20"
            />
        </>
    );
}
