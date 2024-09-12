import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {
    searchResultViewBodyTextSnippetFontSize,
    searchResultViewPaddingY,
    searchResultViewTitleFontSize,
    searchResultViewTitleMarginBottom,
} from "~/client/styles/search_shared_styles.js";
import {Sprinkles, colorSchemeVars} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/spacing.js";

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
                        <TextShimmer fontSize={searchResultViewTitleFontSize} width="3" />
                        <TextShimmer fontSize={searchResultViewTitleFontSize} width={titleWidth} />
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
