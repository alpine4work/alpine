import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {
    searchResultViewBodyTextSnippetFontSize,
    searchResultViewPaddingY,
    searchResultViewTitleFontSize,
    searchResultViewTitleLineHeightPx,
    searchResultViewTitleMarginBottom,
} from "~/client/styles/search_shared_styles.js";
import {Sprinkles, colorSchemeVars, fontSizes} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function SearchResultShimmer({
    marginX = "1",
    paddingX = "4",
    withBorderTop = false,
    titleWidth,
    bodySnippetRagRight,
}: {
    marginX?: Spacing;
    paddingX?: Sprinkles["paddingX"];
    withBorderTop?: boolean;
    titleWidth: Spacing | "full";
    bodySnippetRagRight?: Spacing;
}) {
    const spacingScale = useSpacingScale();

    return (
        <Box paddingX={marginX}>
            <Box paddingX={paddingX}>
                <Box
                    paddingY={searchResultViewPaddingY}
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                        // 1px to layout. Layout needs to be precise since this is rendered in a
                        // virtualized list.
                        boxShadow: [
                            `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                            ...(withBorderTop
                                ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                : []),
                        ].join(", "),
                    }}
                >
                    <Box display="flex" gap="2.5">
                        <TextShimmer
                            fontSize={{
                                fontSize: fontSizes[searchResultViewTitleFontSize].fontSize,
                                lineHeight: `${searchResultViewTitleLineHeightPx[spacingScale]}px`,
                            }}
                            width="3"
                        />
                        <TextShimmer
                            fontSize={{
                                fontSize: fontSizes[searchResultViewTitleFontSize].fontSize,
                                lineHeight: `${searchResultViewTitleLineHeightPx[spacingScale]}px`,
                            }}
                            width={titleWidth}
                        />
                    </Box>
                    <Spacer space={searchResultViewTitleMarginBottom} />
                    <TextShimmer
                        fontSize={searchResultViewBodyTextSnippetFontSize}
                        width="32"
                        ragRight={bodySnippetRagRight}
                    />
                </Box>
            </Box>
        </Box>
    );
}
