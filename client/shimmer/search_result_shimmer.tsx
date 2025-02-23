import {Box} from "~/client/design/box.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {
    minSearchResultViewHeightPx,
    searchResultViewMediaSize,
    searchResultViewPaddingY,
    searchResultViewTitleFontSize,
} from "~/client/styles/search_shared_styles.js";
import {
    Sprinkles,
    contentStyles,
    fontSizes,
    pulseAnimationClassName,
} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function SearchResultShimmer({
    marginX = "1",
    paddingX = "2.5",
    titleWidth,
}: {
    marginX?: Spacing;
    paddingX?: Sprinkles["paddingX"];
    titleWidth: Spacing | "full";
}) {
    const spacingScale = useSpacingScale();

    return (
        <Box paddingX={marginX}>
            <Box paddingX={paddingX}>
                <Box
                    paddingY={searchResultViewPaddingY}
                    style={{minHeight: minSearchResultViewHeightPx[spacingScale]}}
                >
                    <Box display="flex" alignItems="center" gap="1.5">
                        <Box
                            width={searchResultViewMediaSize}
                            height={searchResultViewMediaSize}
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                        >
                            <Box
                                className={pulseAnimationClassName}
                                width="3"
                                height="3"
                                backgroundColor="grey-5"
                                borderRadius="full"
                            />
                        </Box>
                        <TextShimmer
                            fontSize={{
                                fontSize: fontSizes[searchResultViewTitleFontSize].fontSize,
                                lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
                            }}
                            width={titleWidth}
                            ragRight="random"
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
