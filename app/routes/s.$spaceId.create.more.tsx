import {IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {useShowToast} from "~/client/design/toast.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {ChannelBrandIcon} from "~/client/icons/brand/channel_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/icons/brand/task_collection_brand_icon.js";
import {TaskViewBrandIcon} from "~/client/icons/brand/task_view_brand_icon.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {screenPaddingX, spacing} from "~/shared/design/spacing.js";
import {generateId} from "~/shared/id/id.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";

export function meta() {
    return [{title: `Create${metaTitlePostfix}`}];
}

export default function CreateMoreRoute() {
    const isMobile = useIsMobile();
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();

    const maxWidth = !isMobile ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            withMobileLayout={isMobile}
            title="Create"
            withoutDisappearingTitle={true}
            titleJustifyContents="center"
            desktopMaxWidth={maxWidth}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <CreateMoreRouteDivider />
                <CreateMoreRouteButton
                    icon={<ChannelBrandIcon />}
                    label="Channel"
                    pressErrorTitle="Couldn’t create channel"
                    onPress={async () => {
                        const channelId = generateId();

                        await rootNavigate(`/s/${space.id}/channels/${channelId}?create`);
                    }}
                />
                <CreateMoreRouteDivider />
                <CreateMoreRouteButton
                    icon={<TaskCollectionBrandIcon />}
                    label="Task collection"
                    pressErrorTitle="Couldn’t create task collection"
                    onPress={async () => {
                        const collectionId = generateId();

                        await rootNavigate(
                            `/s/${space.id}/tasks/collections/${collectionId}?create`,
                        );
                    }}
                />
                <CreateMoreRouteDivider />
                <CreateMoreRouteButton
                    icon={<TaskViewBrandIcon />}
                    label="Task view"
                    pressErrorTitle="Couldn’t create task view"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/tasks/view`);
                    }}
                />
                <CreateMoreRouteDivider />
            </Box>
        </SpaceRouteScrollView>
    );
}

function CreateMoreRouteDivider() {
    return (
        <Box paddingY="1">
            <Box width="full" borderBottom="grey-5" />
        </Box>
    );
}

function CreateMoreRouteButton({
    icon,
    label,
    pressErrorTitle,
    onPress,
}: {
    icon: ReactNode;
    label: string;
    pressErrorTitle: string;
    onPress: () => Promise<void>;
}) {
    const showToast = useShowToast();

    const [isPending, setIsPending] = useState(false);
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            setIsPending(true);

            // Wrap in an async function so if `onPress` throws synchronously we get a
            // rejected promise that we handle below.
            const promise = (async () => await onPress())();

            promise.then(
                () => {
                    setIsPending(false);
                },
                error => {
                    setIsPending(false);

                    showToast({
                        type: "Error",
                        title: pressErrorTitle,
                        error,
                    });
                },
            );
        },
    });

    const {isHovered, hoverProps} = useHover({});

    return (
        <Box
            {...mergeProps(pressProps, hoverProps)}
            height="9"
            paddingX="2.5"
            display="flex"
            alignItems="center"
            gap="2.5"
            borderRadius="base"
            aria-label={label}
            backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
        >
            <Box flexShrink="0">
                <IconContext.Provider
                    value={{
                        color: isPressed ? colorSchemeVars["grey-90"] : colorSchemeVars["grey-80"],
                    }}
                >
                    {icon}
                </IconContext.Provider>
            </Box>
            <Box flexGrow="1">{label}</Box>
            <Box flexShrink="0" width="4" color="grey-70">
                {shouldShowPendingSpinner && (
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                )}
            </Box>
        </Box>
    );
}
