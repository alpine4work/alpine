import {Bell, Robot, SquaresFour, User, Users} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {MobileSettingsRow} from "~/client/web/design/mobile_settings_row.js";
import {BuildingsIcon} from "~/client/web/icons/buildings_icon.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";

export function meta() {
    return [{title: `Settings${metaTitlePostfix}`}];
}

export default function MobileSpaceSettingsRoute() {
    const platform = usePlatform();
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const rootNavigate = useRootNavigate();

    // this route is accesible in desktop version as well so we give some max width for
    // desktop to make it look good.
    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            title="Settings"
            defaultPreviousRoute={`/s/${space.id}/more`}
        >
            <Box
                width="full"
                paddingX={screenPaddingX}
                maxWidth={maxWidth}
                marginX="center"
                display="flex"
                flexDirection="column"
                gap="8"
            >
                <Box>
                    <Box paddingX="2.5" paddingY="2.5" fontSize="50" color="grey-50">
                        My settings
                    </Box>
                    <MobileSettingsRow
                        withBorderTop
                        icon={<User />}
                        label="Profile"
                        pressErrorTitle="Couldn&#x2019;t open profile settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/settings/profile`);
                        }}
                    />
                    <MobileSettingsRow
                        icon={<Bell />}
                        label="Notifications"
                        pressErrorTitle="Couldn&#x2019;t open notification settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/settings/notifications`);
                        }}
                    />
                </Box>
                <Box>
                    <Box paddingX="2.5" paddingY="2.5" fontSize="50" color="grey-50">
                        Space settings
                    </Box>
                    <MobileSettingsRow
                        withBorderTop
                        icon={<BuildingsIcon />}
                        label="General"
                        pressErrorTitle="Couldn&#x2019;t open general settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/settings/general`);
                        }}
                    />
                    <MobileSettingsRow
                        icon={<Users />}
                        label="People"
                        pressErrorTitle="Couldn&#x2019;t open people settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/settings/people`);
                        }}
                    />
                    <MobileSettingsRow
                        icon={<Robot />}
                        label="Bots"
                        pressErrorTitle="Couldn&#x2019;t open bot settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/settings/bots`);
                        }}
                    />
                    <MobileSettingsRow
                        icon={<SquaresFour />}
                        label="Integrations"
                        pressErrorTitle="Couldn&#x2019;t open integrations settings"
                        onPress={async () => {
                            await rootNavigate(`/s/${space.id}/settings/integrations`);
                        }}
                    />
                </Box>
            </Box>
        </SpaceRouteScrollView>
    );
}
