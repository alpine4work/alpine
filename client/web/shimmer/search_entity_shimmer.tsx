import {Box} from "~/client/web/design/box.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    searchEntityViewDefaultMarginX,
    searchEntityViewDefaultPaddingX,
    searchEntityViewMediaSize,
    searchEntityViewMinHeightPx,
    searchEntityViewPaddingY,
    searchEntityViewTitleFontSize,
} from "~/client/web/styles/search_shared_styles.js";
import {
    Sprinkles,
    contentStyles,
    fontSizes,
    pulseAnimationClassName,
} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function SearchEntityShimmer({
    marginX = searchEntityViewDefaultMarginX,
    paddingX = searchEntityViewDefaultPaddingX,
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
                    paddingY={searchEntityViewPaddingY}
                    style={{minHeight: searchEntityViewMinHeightPx[spacingScale]}}
                >
                    <Box display="flex" alignItems="center" gap="1.5">
                        <Box
                            width={searchEntityViewMediaSize}
                            height={searchEntityViewMediaSize}
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
                                fontSize: fontSizes[searchEntityViewTitleFontSize].fontSize,
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
