import {ArrowsLeftRight, Gear, PencilSimple, Recycle, SignOut} from "phosphor-react";
import {usePress} from "react-aria";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {MobileSettingsRow} from "~/client/web/design/mobile_settings_row.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

export function meta() {
    return [{title: `More${metaTitlePostfix}`}];
}

export default function MoreRoute() {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    const {isPressed: isSpacePressed, pressProps: spacePressProps} = usePress({
        onPress: () => {
            rootNavigate(`/s/${space.id}/more/switch-space`);
        },
    });

    const {isPressed: isAccountPressed, pressProps: accountPressProps} = usePress({
        onPress: () => {
            rootNavigate(`/s/${space.id}/settings/profile`);
        },
    });

    return (
        <SpaceRouteScrollView
            title="More"
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <Box display="flex" alignItems="stretch">
                    <Box
                        {...spacePressProps}
                        flexShrink="0"
                        width="1/2"
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        gap="2"
                        paddingX="2"
                        opacity={isSpacePressed ? "60" : undefined}
                    >
                        <SpaceAvatar space={space} size="16" />
                        <Box fontSize="100" fontStyle="truncate-semi-bold">
                            {space.name}
                        </Box>
                        <Spacer space="0.5" />
                        <Box
                            display="flex"
                            alignItems="center"
                            gap="1"
                            color="grey-70"
                            // Optically center given icon on the left.
                            paddingRight="1.5"
                        >
                            <ArrowsLeftRight size={spacing["4"]} />
                            <Box>Switch</Box>
                        </Box>
                    </Box>
                    <Box
                        {...accountPressProps}
                        borderLeft="grey-5"
                        flexShrink="0"
                        width="1/2"
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        gap="2"
                        paddingX="2"
                        opacity={isAccountPressed ? "60" : undefined}
                    >
                        <AccountAvatar account={currentAccount} size="16" />
                        <Box fontSize="100" fontStyle="truncate-semi-bold">
                            {useAccountModel(currentAccount).name}
                        </Box>
                        <Spacer space="0.5" />
                        <Box
                            display="flex"
                            alignItems="center"
                            gap="1"
                            color="grey-70"
                            // Optically center given icon on the left.
                            paddingRight="1.5"
                        >
                            <PencilSimple size={spacing["4"]} />
                            <Box>Edit</Box>
                        </Box>
                    </Box>
                </Box>
                <Spacer space="20" />
                <MobileSettingsRow
                    withBorderTop
                    icon={<Gear />}
                    label="Settings"
                    pressErrorTitle="Couldn&#x2019;t open space settings"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/more/settings`);
                    }}
                />
                <MobileSettingsRow
                    icon={<SignOut />}
                    label="Sign out"
                    pressErrorTitle="Couldn&#x2019;t sign out"
                    onPress={async () => {
                        if (NativeMobileBridge) {
                            NativeMobileBridge.session.signOut();

                            // `signOut()` should destroy the current web browsing context and create a
                            // new one.
                            await new Promise(() => {});
                        } else {
                            await rootNavigate("/sign-out");
                        }
                    }}
                />
                {process.env.NODE_ENV !== "production" && (
                    <MobileSettingsRow
                        icon={<Recycle />}
                        label="[Debug] Unresponsive crash"
                        pressErrorTitle="Couldn&#x2019;t crash"
                        onPress={async () => {
                            while (true) {
                                // Intentionally crash the main thread.
                            }
                        }}
                    />
                )}
            </Box>
        </SpaceRouteScrollView>
    );
}
