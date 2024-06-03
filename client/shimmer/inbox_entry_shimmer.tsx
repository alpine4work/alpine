import {Box} from "~/client/design/box.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {Spacing} from "~/shared/design/spacing.js";
import {inboxEntryViewMinHeight} from "~/shared/styles/inbox_shared_styles.js";
import {pulseAnimationClassName} from "~/shared/styles/styles.js";

export function InboxEntryShimmer({
    titleRagRight,
    subtitleRagRight,
}: {
    titleRagRight: Spacing;
    subtitleRagRight?: Spacing;
}) {
    return (
        <Box
            position="relative"
            paddingX="4"
            display="flex"
            alignItems="center"
            gap="3"
            style={{height: inboxEntryViewMinHeight}}
        >
            <Box
                flexShrink="0"
                width="10"
                height="full"
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
            <Box flexGrow="1">
                <TextShimmer fontSize="75" width="64" ragRight={titleRagRight} />
                <Box height="0.5" />
                <TextShimmer fontSize="50" width="32" ragRight={subtitleRagRight} />
            </Box>
            <Box
                position="absolute"
                left="4"
                right="4"
                borderBottom="grey-5"
                style={{bottom: -1}}
            />
        </Box>
    );
}
