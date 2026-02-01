import {ArrowRight, IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {MobileSettingsRow} from "~/client/web/design/mobile_settings_row.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {ChatBrandBigIcon} from "~/client/web/icons/brand/chat_brand_big_icon.js";
import {DocumentBrandBigIcon} from "~/client/web/icons/brand/document_brand_big_icon.js";
import {PostBrandBigIcon} from "~/client/web/icons/brand/post_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/client/web/icons/brand/task_brand_big_icon.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";

export function meta() {
    return [{title: `Create${metaTitlePostfix}`}];
}

export default function CreateRoute() {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            title="Create"
            withoutDisappearingTitle={true}
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <CreateRouteButton
                    withBorderTop
                    icon={<PostBrandBigIcon />}
                    label="Post"
                    description="Share your ideas in a channel"
                    pressErrorTitle="Couldn&#x2019;t create post"
                    onPress={async () => {
                        const draftId = generateChronologicalId();

                        await rootNavigate(`/s/${space.id}/posts/new/${draftId}?focus=channel`);
                    }}
                />
                <CreateRouteButton
                    icon={<ChatBrandBigIcon />}
                    label="Message"
                    description="Start a chat with anyone"
                    pressErrorTitle="Couldn&#x2019;t open new chat"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/chat/new?focus=picker`);
                    }}
                />
                <CreateRouteButton
                    icon={<DocumentBrandBigIcon />}
                    label="Document"
                    description="Write what&#x2019;s on your mind"
                    pressErrorTitle="Couldn&#x2019;t create document"
                    onPress={async () => {
                        const documentId = generateId();
                        await rootNavigate(`/s/${space.id}/documents/${documentId}?create&focus`);
                    }}
                />
                <CreateRouteButton
                    icon={<TaskBrandBigIcon />}
                    label="Task"
                    description="Keep track of work to do later"
                    pressErrorTitle="Couldn&#x2019;t open tasks"
                    onPress={async () => {
                        const taskId = generateId();
                        await rootNavigate(`/s/${space.id}/tasks/${taskId}?create&focus`);
                    }}
                />
                <MobileSettingsRow
                    withoutBorderBottom
                    icon={<ArrowRight />}
                    iconPlacement="trailing"
                    label="More"
                    pressErrorTitle="Couldn&#x2019;t open more create options"
                    onPress={() => rootNavigate(`/s/${space.id}/create/more`)}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}

function CreateRouteButton({
    icon,
    label,
    description,
    pressErrorTitle,
    onPress,
    withBorderTop,
}: {
    icon: ReactNode;
    label: string;
    description: string;
    pressErrorTitle: string;
    onPress: () => Promise<void>;
    withBorderTop?: boolean;
}) {
    const reporter = useReporter();

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

                    reporter.displayError(pressErrorTitle, error);
                },
            );
        },
    });

    const {isHovered, hoverProps} = useHover({});

    return (
        <Box
            {...mergeProps(pressProps, hoverProps)}
            position="relative"
            zIndex="0"
            paddingX="1.5"
            display="flex"
            alignItems="center"
            gap="3"
            aria-label={label}
            style={{
                // Optically center by including a little less padding top. The icon color
                // splash makes the icon leads to more whitespace near the top of the icon.
                paddingTop: addRemLengths("3", "0.5"),
                paddingBottom: spacing["4"],
                boxShadow:
                    !isPressed && !isHovered
                        ? [
                              `inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                              ...(withBorderTop
                                  ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                  : []),
                          ].join(", ")
                        : undefined,
            }}
        >
            <Box
                position="absolute"
                zIndex="-10"
                borderRadius="1"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
                style={{
                    // Cover the previous button's border bottom. If the top border is rendered by
                    // our element then we don't need to go into the above sibling element's space.
                    top: withBorderTop ? 0 : -1,
                    bottom: 0,
                    left: `-${borderRadius["1"]}`,
                    right: `-${borderRadius["1"]}`,
                }}
            />
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
