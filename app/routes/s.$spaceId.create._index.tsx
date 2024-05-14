import {ArrowRight, IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {useShowToast} from "~/client/design/toast.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {ChatBrandBigIcon} from "~/client/icons/brand/chat_brand_big_icon.js";
import {DocumentBrandBigIcon} from "~/client/icons/brand/document_brand_big_icon.js";
import {PostBrandBigIcon} from "~/client/icons/brand/post_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/client/icons/brand/task_brand_big_icon.js";
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

export default function CreateRoute() {
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
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <CreateRouteDivider />
                <CreateRouteButton
                    icon={<PostBrandBigIcon />}
                    label="Post"
                    description="Share your ideas in a channel"
                    pressErrorTitle="Couldn’t create post"
                    onPress={async () => {
                        const draftId = generateId();

                        await rootNavigate(`/s/${space.id}/posts/new/${draftId}?focus=channel`);
                    }}
                />
                <CreateRouteDivider />
                <CreateRouteButton
                    icon={<ChatBrandBigIcon />}
                    label="Message"
                    description="Start a chat with anyone"
                    pressErrorTitle="Couldn’t open new chat"
                    onPress={async () => {
                        // NOCOMMIT: Auto-focus?
                        await rootNavigate(`/s/${space.id}/chat/new`);
                    }}
                />
                <CreateRouteDivider />
                <CreateRouteButton
                    icon={<DocumentBrandBigIcon />}
                    label="Document"
                    description="Write what’s on your mind"
                    pressErrorTitle="Couldn’t create document"
                    onPress={async () => {
                        const documentId = generateId();

                        // NOCOMMIT: Auto-focus?
                        await rootNavigate(`/s/${space.id}/documents/${documentId}?create`);
                    }}
                />
                <CreateRouteDivider />
                <CreateRouteButton
                    icon={<TaskBrandBigIcon />}
                    label="Task"
                    description="Keep track of work to do later"
                    pressErrorTitle="Couldn’t open tasks"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/tasks`);
                    }}
                />
                <CreateRouteDivider />
                <CreateRouteMoreButton
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/create/more`);
                    }}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}

function CreateRouteDivider() {
    return (
        <Box paddingY="1">
            <Box width="full" borderBottom="grey-5" />
        </Box>
    );
}

function CreateRouteButton({
    icon,
    label,
    description,
    pressErrorTitle,
    onPress,
}: {
    icon: ReactNode;
    label: string;
    description: string;
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
            paddingX="1.5"
            paddingY="2.5"
            display="flex"
            alignItems="center"
            gap="3"
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
            <Box flexGrow="1">
                <Box fontStyle="semi-bold" fontSize="100">
                    {label}
                </Box>
                <Box fontSize="75" color="grey-60">
                    {description}
                </Box>
            </Box>
            <Box flexShrink="0" width="4" color="grey-70">
                {shouldShowPendingSpinner && (
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                )}
            </Box>
        </Box>
    );
}

function CreateRouteMoreButton({onPress}: {onPress: () => Promise<void>}) {
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
                        title: "Couldn’t show more create options",
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
            backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
        >
            <Box flexGrow="1">More</Box>
            {shouldShowPendingSpinner ? (
                <Box flexShrink="0" width="4" color="grey-70">
                    {shouldShowPendingSpinner && (
                        <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                    )}
                </Box>
            ) : (
                <Box flexShrink="0" width="4" color={isPressed ? "grey-100" : "grey-70"}>
                    <ArrowRight size={spacing["4"]} />
                </Box>
            )}
        </Box>
    );
}
