import {useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    postFauxInputCreateButtonHeight,
    postFauxInputCreateButtonInnerButtonHeight,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    inputPlaceholderStyles,
    pressOpacityOverlayClassName,
} from "~/client/web/styles/styles.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";

export function PostFauxInputCreateButton({channel}: {channel: ChannelModel}) {
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const buttonRef = useRef<HTMLDivElement>(null);
    const {buttonProps, isPressed} = useButton(
        {
            elementType: "div",
            onPress: () => {
                const draftId = generateChronologicalId();

                // When in a mobile layout (e.g. a peek) then don't close the peek after a post is
                // created. We want to navigate to the post and the user can navigate back to the
                // channel with the back button.
                if (routeLayout === "narrow") {
                    navigate(
                        `/post/new/${draftId}/${space.id}?channel=${channel.id}&focus=content`,
                    );
                } else {
                    navigate(
                        `/post/new/${draftId}/${space.id}?channel=${channel.id}&focus=content&return=back`,
                    );
                }
            },
        },
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
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
                // This is meant to be a fake text input so show text cursor to sell the illusion.
                cursor="text"
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
                    // This is meant to look like placeholder text and only be used by sighted users.
                    aria-hidden={true}
                >
                    Share your ideas…
                </Box>
                <Box
                    paddingX="2"
                    height={postFauxInputCreateButtonInnerButtonHeight}
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
