import {ArrowsLeftRight, Gear, Users} from "phosphor-react";
import {useRef} from "react";
import {useButton} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {OverlayTriggerButtonRef} from "~/client/design/overlay_trigger_button.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {buttonStyles, sprinkles} from "~/client/styles/styles.js";
import {getOurAccountSpaces} from "~/shared/rpc/spaces_rpc_definitions.js";
import {hasSpaceSettingsFeature} from "~/shared/spaces/has_space_settings_feature.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceLayoutSideBarSpaceButton({space}: {space: SpaceModel}) {
    const context = useAppContext();
    const rootNavigate = useRootNavigate();
    const menuButtonRef = useRef<OverlayTriggerButtonRef>(null);

    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({}, buttonRef);

    const settingsAction = {
        icon: <Gear />,
        size: "lg",
        label: "Settings",
        pressErrorTitle: "Couldn’t open settings",
        onPress: async () => {
            await rootNavigate(`/s/${space.id}/settings/general`);
        },
    };

    const membersSettingsAction = {
        icon: <Users />,
        size: "lg",
        label: "People",
        pressErrorTitle: "Couldn’t open people settings",
        onPress: async () => {
            await rootNavigate(`/s/${space.id}/settings/people`);
        },
    };

    const hideSettings = !hasSpaceSettingsFeature(space.id);

    return (
        <MenuButton
            ref={menuButtonRef}
            placement="right-start"
            // Vertically center space name in `extraOverlayTop` with space avatar.
            offsetAlong="-1"
            extraOverlayTop={
                <>
                    <Box paddingX="2" paddingY="1" fontSize="200" fontStyle="semi-bold">
                        {space.name}
                    </Box>
                    <Box paddingX="1" paddingY="1">
                        <Box width="full" borderBottom="grey-5" />
                    </Box>
                </>
            }
            actions={[
                ...(hideSettings ? [] : [settingsAction, membersSettingsAction]),
                [
                    {
                        hasChildren: true,
                        key: "switch-space",
                        icon: <ArrowsLeftRight />,
                        label: "Switch space",
                        size: "lg",
                        actions: async () => {
                            const {spaces: otherSpaces} = await getOurAccountSpaces(context, {});
                            return otherSpaces.map(
                                ({space: otherSpace, inbox}): MenuAction => ({
                                    isSelected: otherSpace.id === space.id,
                                    label: otherSpace.name,
                                    labelFontSize: "100",
                                    labelFontStyle: "semi-bold",
                                    icon: (
                                        <Box
                                            position="relative"
                                            // Picked so we get the same margin horizontally and vertically between the
                                            // `<SpaceAvatar>` and hover/press background edge.
                                            paddingY="0.5"
                                        >
                                            <SpaceAvatar space={otherSpace} size="8" />
                                            {inbox && inbox.model.loudNotificationCount > 0 && (
                                                <LoudNotificationBadge
                                                    top="-0.0625rem"
                                                    right="0.125rem"
                                                    count={inbox.model.loudNotificationCount}
                                                />
                                            )}
                                        </Box>
                                    ),
                                    pressErrorTitle: "Couldn’t switch to space",
                                    onPress: async () => {
                                        if (otherSpace.id === space.id) return;

                                        await rootNavigate(`/s/${otherSpace.id}`);
                                    },
                                }),
                            );
                        },
                    },
                ],
            ]}
        >
            <FocusRing>
                <button
                    {...buttonProps}
                    ref={buttonRef}
                    className={sprinkles({
                        position: "relative",
                        borderRadius: spaceAvatarBorderRadius,
                    })}
                >
                    {isPressed && (
                        <Box
                            position="absolute"
                            inset="0"
                            borderRadius={spaceAvatarBorderRadius}
                            backgroundColor="grey-100-const"
                            pointerEvents="none"
                            style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                        />
                    )}
                    <SpaceAvatar space={space} size="8" />
                </button>
            </FocusRing>
        </MenuButton>
    );
}
