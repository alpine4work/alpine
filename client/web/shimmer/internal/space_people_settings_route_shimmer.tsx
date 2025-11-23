import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function SpacePeopleSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <PeopleSpaceSettingsRouteShimmerContent />
        </SpaceSettingsRouteLayoutShimmer>
    );
}

function PeopleSpaceSettingsRowShimmer({
    nameWidth,
    isRemoved,
    index,
}: {
    nameWidth: Spacing;
    isRemoved?: boolean;
    index?: number;
}) {
    return (
        <Box
            height="14"
            borderTop={index === 0 ? "grey-5" : undefined}
            borderBottom="grey-5"
            display="flex"
            alignItems="center"
            gap="3"
        >
            <Box
                backgroundColor="grey-5"
                className={pulseAnimationClassName}
                borderRadius="full"
                width="8"
                height="8"
            />
            <TextShimmer fontSize="100" width={nameWidth} />
            <Box flexGrow="1" />

            <TextShimmer fontSize="100" width={isRemoved ? "28" : "16"} />
        </Box>
    );
}

function PeopleSpaceSettingsRouteShimmerContent() {
    const [resizeRef, size] = useResizeObserver();
    const isMobile = usePlatform() === "mobile";

    const renderDescriptionShimmer = (minWidth: number) => {
        const containerWidth = size?.width;

        if (isMobile && containerWidth && containerWidth < minWidth) {
            return (
                <>
                    <TextShimmer fontSize="75" width="64" />
                    <TextShimmer fontSize="75" width="28" />
                </>
            );
        } else {
            // On desktop, use a single longer line
            return <TextShimmer fontSize="75" width="96" />;
        }
    };

    return (
        <Box ref={resizeRef} width="full">
            <TextShimmer fontSize="200" width="20" />
            <Box color="grey-60" userSelect="text" paddingTop="1" paddingBottom="6">
                {renderDescriptionShimmer(470)}
            </Box>

            <PeopleSpaceSettingsRowShimmer index={0} nameWidth="28" />
            <PeopleSpaceSettingsRowShimmer nameWidth="32" />
            <PeopleSpaceSettingsRowShimmer nameWidth="24" />
            <PeopleSpaceSettingsRowShimmer nameWidth="12" />
            <PeopleSpaceSettingsRowShimmer nameWidth="28" />

            <Spacer space="10" />
            <TextShimmer fontSize="200" width="48" ragRight="12" />
            <Box color="grey-60" userSelect="text" paddingTop="1" paddingBottom="6">
                {renderDescriptionShimmer(540)}
            </Box>

            <PeopleSpaceSettingsRowShimmer isRemoved index={0} nameWidth="24" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="28" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="24" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="12" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="28" />
        </Box>
    );
}
