import {ArrowsLeftRight, Gear, PencilSimple, Recycle, SignOut} from "phosphor-react";
import {usePress} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {MobileSettingsRow} from "~/client/design/mobile_settings_row.js";
import {Spacer} from "~/client/design/spacer.js";
import {SpaceRouteScrollView} from "~/client/navigation/space_route_scroll_view.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

export function meta() {
    return [{title: `More${metaTitlePostfix}`}];
}

export default function MoreRoute() {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const withSpaceSettings = process.env.NODE_ENV !== "production";

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    const {isPressed: isSpacePressed, pressProps: spacePressProps} = usePress({
        onPress: () => {
            rootNavigate(`/s/${space.id}/more/switch-space`);
        },
    });

    const {isPressed: isAccountPressed, pressProps: accountPressProps} = usePress({});

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
                {withSpaceSettings && (
                    <MobileSettingsRow
                        withBorderTop
                        icon={<Gear />}
                        label="Space settings"
                        pressErrorTitle="Couldn’t open space settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/more/settings`);
                        }}
                    />
                )}
                <MobileSettingsRow
                    withBorderTop={!withSpaceSettings}
                    icon={<SignOut />}
                    label="Sign out"
                    pressErrorTitle="Couldn’t sign out"
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
                        pressErrorTitle="Couldn’t crash"
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
