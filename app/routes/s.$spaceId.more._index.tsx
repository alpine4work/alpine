import {ArrowsLeftRight, PencilSimple, SignOut} from "phosphor-react";
import {usePress} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {Box} from "~/client/design/box.js";
import {MobileSettingsRow} from "~/client/design/mobile_settings_row.js";
import {Spacer} from "~/client/design/spacer.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {screenPaddingX, spacing} from "~/shared/design/spacing.js";

export function meta() {
    return [{title: `More${metaTitlePostfix}`}];
}

export default function MoreRoute() {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContext();

    const maxWidth = !isMobile ? "96" : undefined;

    const {isPressed: isSpacePressed, pressProps: spacePressProps} = usePress({
        onPress: () => {
            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
            void navigate(`/s/${space.id}/more/switch-space`);
        },
    });

    const {isPressed: isAccountPressed, pressProps: accountPressProps} = usePress({});

    return (
        <SpaceRouteScrollView
            withMobileLayout={isMobile}
            title="More"
            titleJustifyContents="center"
            desktopMaxWidth={maxWidth}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <Box display="flex">
                    <Box
                        {...spacePressProps}
                        flexGrow="1"
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
                    <Box alignSelf="stretch" borderLeft="grey-5" />
                    <Box
                        {...accountPressProps}
                        flexGrow="1"
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
                    icon={<SignOut />}
                    label="Sign out"
                    pressErrorTitle="Couldn’t sign out"
                    onPress={async () => {
                        // NOCOMMIT: Implement
                    }}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}
