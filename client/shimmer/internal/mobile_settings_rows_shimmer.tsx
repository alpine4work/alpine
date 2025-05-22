import {Box} from "~/client/design/box.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/design/navigation_bar_helpers.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {
    MobileBackButton,
    MobileBackButtonSpacer,
} from "~/client/shimmer/internal/mobile_back_button.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {Spacing, screenPaddingX} from "~/shared/design/core/spacing.js";

// This shimmer is for mobile routes which have a navigation bar and a list of
// settings rows made out of `<MobileSettingsRow />` components.
//
// Pages include:
// - `/s/$spaceId/more/settings`
// - `/s/$spaceId/create/more`
export function MobileSettingsRowsShimmer({titleWidth}: {titleWidth: Spacing}) {
    const platform = usePlatform();
    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <Box width="full" height="full">
            <Box width="full" maxWidth={maxWidth} paddingTop="safe-area-inset" marginX="center">
                <Box
                    width="full"
                    height={navigationBarHeight}
                    paddingX={navigationBarMobileGap}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    <MobileBackButton />
                    <TextShimmer fontSize="100" width={titleWidth} />
                    <MobileBackButtonSpacer />
                </Box>
                <Box paddingX={screenPaddingX}>
                    <MobileSettingsRowShimmer withBorderTop ragRight="12" />
                    <MobileSettingsRowShimmer ragRight="4" />
                    <MobileSettingsRowShimmer ragRight="10" />
                </Box>
            </Box>
        </Box>
    );
}

function MobileSettingsRowShimmer({
    ragRight,
    withBorderTop,
}: {
    ragRight: Spacing;
    withBorderTop?: boolean;
}) {
    return (
        <Box
            paddingX="2.5"
            paddingY="1.5"
            style={{
                boxShadow: [
                    `inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                    ...(withBorderTop ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`] : []),
                ].join(", "),
            }}
        >
            <Box width="full" height="9" display="flex" alignItems="center">
                <TextShimmer fontSize="100" width="32" ragRight={ragRight} />
            </Box>
        </Box>
    );
}
