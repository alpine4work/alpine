import {Box} from "~/client/web/design/box.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {
    MobileBackButton,
    MobileBackButtonSpacer,
} from "~/client/web/shimmer/internal/mobile_back_button.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {Spacing, screenPaddingX} from "~/shared/design/core/spacing.js";

// This shimmer is for mobile routes which have a navigation bar and a list of
// settings rows made out of `<MobileSettingsRow />` components.
//
// Pages include:
//
// - `/s/$spaceId/more/settings`
// - `/s/$spaceId/create/more`
export function MobileSettingsRowsShimmer({
    titleWidth,
    sectionCounts,
}: {
    titleWidth: Spacing;
    sectionCounts: Array<number>;
}) {
    const platform = usePlatform();
    const maxWidth = platform !== "mobile" ? "96" : undefined;

    const hasHeaders = sectionCounts.length > 1;
    const sections = sectionCounts.map((rowCounts, i) => {
        const rows = [];
        for (let j = 0; j < rowCounts; j++) {
            rows.push(
                <MobileSettingsRowShimmer
                    key={j}
                    ragRight={j % 3 === 0 ? "12" : j % 3 === 1 ? "4" : "10"}
                    withBorderTop={j === 0}
                />,
            );
        }

        return (
            <Box key={i} paddingX={screenPaddingX}>
                {hasHeaders ? (
                    <Box paddingX="2.5" paddingY="2.5">
                        <TextShimmer fontSize="50" width="16" />
                    </Box>
                ) : null}
                {rows}
            </Box>
        );
    });

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
                <Box display="flex" flexDirection="column" gap="8">
                    {sections}
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
