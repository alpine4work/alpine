import {ArrowsLeftRight, Gear, Plus, Robot, SquaresFour, Users} from "phosphor-react";
import {useRef} from "react";
import {useButton} from "react-aria";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuAction, MenuSize} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {OverlayTriggerButtonRef} from "~/client/web/design/overlay_trigger_button.js";
import {LoudNotificationBadge} from "~/client/web/inbox/loud_notification_badge.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {spaceAvatarBorderRadius} from "~/client/web/styles/space_settings_shared_styles.js";
import {buttonStyles, sprinkles} from "~/client/web/styles/styles.js";
import {neverPromise} from "~/shared/helpers/async/never_promise.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getOurAccountSpaces} from "~/shared/rpc/spaces_rpc_definitions.js";

export function SpaceLayoutSideBarSpaceButton() {
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const rootNavigate = useRootNavigate();
    const context = useAppContext();
    const menuButtonRef = useRef<OverlayTriggerButtonRef>(null);

    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton(
        {"aria-label": "Space"},
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        buttonRef,
    );

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
                {
                    icon: <Gear />,
                    size: "lg",
                    label: "Settings",
                    pressErrorTitle: "Couldn\u2019t open settings",
                    onPress: async () => {
                        await rootNavigate(`/settings/${space.id}/general`);
                    },
                },
                {
                    icon: <Users />,
                    size: "lg",
                    label: "People",
                    pressErrorTitle: "Couldn\u2019t open people settings",
                    onPress: async () => {
                        await rootNavigate(`/settings/${space.id}/people`);
                    },
                },
                {
                    icon: <Robot />,
                    size: "lg",
                    label: "Bots",
                    pressErrorTitle: "Couldn\u2019t open bot settings",
                    onPress: async () => {
                        await rootNavigate(`/settings/${space.id}/bots`);
                    },
                },
                {
                    icon: <SquaresFour />,
                    size: cast<MenuSize>("lg"),
                    label: "Integrations",
                    pressErrorTitle: "Couldn\u2019t open integrations settings",
                    onPress: async () => {
                        await rootNavigate(`/settings/${space.id}/integrations`);
                    },
                },
                [
                    {
                        hasChildren: true,
                        key: "switch-space",
                        icon: <ArrowsLeftRight />,
                        label: "Switch space",
                        size: "lg",
                        actions: async () => {
                            const {spaces: otherSpaces} = await getOurAccountSpaces(context, {});

                            const actions = otherSpaces.map(
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
                                    pressErrorTitle: "Couldn\u2019t switch to space",
                                    onPress: async () => {
                                        if (otherSpace.id === space.id) return;

                                        // We must perform a full page navigation when switching spaces in order to reload
                                        // the `_space` route with a new `SpaceId`. We can't currently perform single page
                                        // navigation to a new space because the `_space` route must run in parallel with
                                        // some other loaders and currently Remix makes a network request for each
                                        // individual loader on single page navigation.
                                        window.location.assign(`/home/${otherSpace.id}`);
                                        await neverPromise;
                                    },
                                }),
                            );

                            actions.push({
                                label: "Create space",
                                labelFontSize: "100",
                                labelFontStyle: "semi-bold",
                                icon: (
                                    <Box paddingY="0.5">
                                        <Box
                                            position="relative"
                                            // Picked so we get the same margin horizontally and vertically between the icon
                                            // and hover/press background edge.
                                            width="8"
                                            height="8"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                            borderRadius={spaceAvatarBorderRadius}
                                            backgroundColor="grey-10"
                                        >
                                            <Plus />
                                        </Box>
                                    </Box>
                                ),
                                pressErrorTitle: "Couldn\u2019t create space",
                                onPress: async () => {
                                    await rootNavigate(`/create-space`);
                                },
                            });

                            return actions;
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
                        zIndex: "0",
                        borderRadius: spaceAvatarBorderRadius,
                    })}
                >
                    {isPressed && (
                        <Box
                            position="absolute"
                            zIndex="10"
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
