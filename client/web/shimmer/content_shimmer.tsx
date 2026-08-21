import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {contentStyles, fontSizes} from "~/client/web/styles/styles.js";

const contentParagraphShimmerFontSize = {
    ...fontSizes["50"],
    lineHeight: contentStyles.paragraphFontSize.lineHeight,
} as const;

export function ContentParagraphShimmer1() {
    return (
        <>
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="12" />
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="4" />
            <TextShimmer
                width="64"
                fontSize={contentParagraphShimmerFontSize}
                // So when screen shrinks last line isn't longer than other lines with `ragRight`.
                ragRight="20"
            />
        </>
    );
}

export function ContentParagraphShimmer2() {
    return (
        <>
            <TextShimmer width="full" ragRight="16" fontSize={contentParagraphShimmerFontSize} />
            <TextShimmer
                width="128"
                fontSize={contentParagraphShimmerFontSize}
                // So when screen shrinks last line isn't longer than other lines with `ragRight`.
                ragRight="20"
            />
        </>
    );
}

export function ContentParagraphShimmer3() {
    return (
        <>
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="8" />
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="2" />
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="16" />
            <TextShimmer
                width="48"
                fontSize={contentParagraphShimmerFontSize}
                // So when screen shrinks last line isn't longer than other lines with `ragRight`.
                ragRight="20"
            />
        </>
    );
}

export function ContentParagraphShimmer4() {
    return <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="4" />;
}
