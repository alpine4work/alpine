import {useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {postFauxInputCreateButtonHeight} from "~/client/styles/forum_shared_styles.js";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    inputPlaceholderStyles,
    pressOpacityOverlayClassName,
} from "~/client/styles/styles.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";

export function PostFauxInputCreateButton({
    channel,
    isCreatingChannel,
}: {
    channel: ChannelModel;
    isCreatingChannel: boolean;
}) {
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const buttonRef = useRef<HTMLDivElement>(null);
    const {buttonProps, isPressed} = useButton(
        {
            elementType: "div",
            isDisabled: isCreatingChannel,
            onPress: () => {
                const draftId = generateChronologicalId();

                // When in a mobile layout (e.g. a peek) then don't close the peek after a post
                // is created. We want to navigate to the post and the user can navigate back
                // to the channel with the back button.
                if (routeLayout === "narrow") {
                    navigate(
                        `/s/${space.id}/posts/new/${draftId}?channel=${channel.id}&focus=content`,
                    );
                } else {
                    navigate(
                        `/s/${space.id}/posts/new/${draftId}?channel=${channel.id}&focus=content&return=back`,
                    );
                }
            },
        },
        buttonRef,
    );

    return (
        <FocusRing offset="border">
            <Box
                ref={buttonRef}
                position="relative"
                height={postFauxInputCreateButtonHeight}
                overflow="hidden"
                padding="2.5"
                boxShadow="elevation-5-with-grey-10-border"
                borderRadius="1.5"
                display="flex"
                alignItems="center"
                // This is meant to be a fake text input so show text cursor to sell the
                // illusion.
                cursor={!isCreatingChannel ? "text" : undefined}
                {...(buttonProps as any)}
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="50"
                        pointerEvents="none"
                        className={pressOpacityOverlayClassName}
                    />
                )}
                <Box
                    flexGrow="1"
                    paddingX="1.5"
                    fontSize="100"
                    style={inputPlaceholderStyles}
                    // This is meant to look like placeholder text and only be used by
                    // sighted users.
                    aria-hidden={true}
                >
                    Share your ideas…
                </Box>
                <Box
                    paddingX="2"
                    height="7"
                    minWidth="16"
                    backgroundColor={accentThemeBackgroundColor}
                    color={accentThemeForegroundColor}
                    borderRadius="1"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    Post
                </Box>
            </Box>
        </FocusRing>
    );
}
