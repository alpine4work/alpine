import {assignInlineVars} from "@vanilla-extract/dynamic";
import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {contentSchemaStyles, fontSizes, pulseAnimationClassName} from "~/shared/styles/styles.js";

export const contentParagraphShimmerFontSize = {
    ...fontSizes["50"],
    lineHeight: contentSchemaStyles.paragraphFontSize.lineHeight,
} as const;

export function ContentParagraphShimmer1() {
    return (
        <>
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="12" />
            <TextShimmer width="full" fontSize={contentParagraphShimmerFontSize} ragRight="4" />
            <TextShimmer
                width="64"
                fontSize={contentParagraphShimmerFontSize}
                // So when screen shrinks last line isn't longer than other lines with
                // `ragRight`.
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
                // So when screen shrinks last line isn't longer than other lines with
                // `ragRight`.
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
                // So when screen shrinks last line isn't longer than other lines with
                // `ragRight`.
                ragRight="20"
            />
        </>
    );
}

export function ContentListItemShimmer({children}: {children?: ReactNode}) {
    return (
        <Box
            position="relative"
            paddingLeft={contentSchemaStyles.listItemIndentation}
            style={assignInlineVars({[contentSchemaStyles.listItemIndentationVar]: "0"})}
        >
            <Box position="absolute" inset="0" left={`-${contentSchemaStyles.blockPaddingX}`}>
                <Box
                    className={pulseAnimationClassName}
                    position="absolute"
                    backgroundColor="grey-5"
                    width={contentSchemaStyles.bulletListItemBulletSize}
                    height={contentSchemaStyles.bulletListItemBulletSize}
                    borderRadius="full"
                    style={{
                        top: contentSchemaStyles.bulletListItemBulletTop,
                        left: contentSchemaStyles.bulletListItemBulletLeft,
                        // Make bullets a little bigger so they look natural next to shimmer text.
                        transform: "scale(1.375)",
                    }}
                />
            </Box>
            {children}
        </Box>
    );
}
