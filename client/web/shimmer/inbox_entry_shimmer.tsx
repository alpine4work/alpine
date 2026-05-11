import {Box} from "~/client/web/design/box.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {inboxEntryViewMinHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {Sprinkles, colorSchemeVars, pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function InboxEntryShimmer({
    marginX = "1",
    paddingX = "4",
    withBorderTop,
    titleRagRight,
    subtitleRagRight,
}: {
    marginX?: Spacing;
    paddingX?: Sprinkles["paddingX"];
    withBorderTop?: boolean;
    titleRagRight: Spacing;
    subtitleRagRight?: Spacing;
}) {
    return (
        <Box paddingX={marginX} style={{minHeight: inboxEntryViewMinHeight}}>
            <Box paddingX={paddingX} position="relative" zIndex="0">
                <Box
                    position="absolute"
                    top="0"
                    bottom="0"
                    left="2.5"
                    right="2.5"
                    zIndex="-10"
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute 1px
                        // to layout. Layout needs to be precise since this is rendered in a virtualized
                        // list.
                        boxShadow: [
                            `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                            ...(withBorderTop
                                ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                : []),
                        ].join(", "),
                    }}
                />
                <Box display="flex" alignItems="center" gap="3">
                    <Box flexShrink="0" width="10" paddingY="4">
                        <Box
                            width="10"
                            height="10"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                        >
                            <Box
                                className={pulseAnimationClassName}
                                flexShrink="0"
                                width="9"
                                height="9"
                                backgroundColor="grey-10"
                                borderRadius="full"
                            />
                        </Box>
                    </Box>
                    <Box flexGrow="1" paddingY="4">
                        <TextShimmer fontSize="75" width="64" ragRight={titleRagRight} />
                        <Box height="0.5" />
                        <TextShimmer fontSize="50" width="32" ragRight={subtitleRagRight} />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
