import {useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {generateId} from "~/shared/id/id.js";
import {inputPlaceholderStyles, pressOpacityOverlayClassName} from "~/shared/styles/styles.js";

export const postFauxInputCreateButtonHeight = "12";

export function PostFauxInputCreateButton({
    channel,
    isCreatingChannel,
}: {
    channel: ChannelModel;
    isCreatingChannel: boolean;
}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const buttonRef = useRef<HTMLDivElement>(null);
    const {buttonProps, isPressed} = useButton(
        {
            elementType: "div",
            isDisabled: isCreatingChannel,
            onPress: () => {
                const draftId = generateId();

                // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                void navigate(
                    `/s/${space.id}/posts/new/${draftId}?channel=${channel.id}&focus=content&return=back`,
                );
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
                borderRadius="md"
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
                <Box flexGrow="1" paddingX="1.5" fontSize="100" style={inputPlaceholderStyles}>
                    Share your ideas…
                </Box>
                <Box
                    paddingX="2"
                    height="7"
                    minWidth="16"
                    backgroundColor="theme-40-const"
                    color="grey-0"
                    borderRadius="base"
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
