import {Envelope, Gear, Users} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {MobileSettingsRow} from "~/client/design/mobile_settings_row.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {SpaceRouteScrollView} from "~/client/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {hasNotificationSettingsFeature} from "~/shared/spaces/has_notification_settings_feature.js";
import {hasProfileSettingsFeature} from "~/shared/spaces/has_profile_settings_feature.js";
import {hasSpaceSettingsFeature} from "~/shared/spaces/has_space_settings_feature.js";

export function meta() {
    return [{title: `Space settings${metaTitlePostfix}`}];
}

export default function MobileSpaceSettingsRoute() {
    const platform = usePlatform();
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const rootNavigate = useRootNavigate();

    // this route is accesible in desktop version as well so we give some max width for desktop
    // to make it look good.
    const maxWidth = platform !== "mobile" ? "96" : undefined;

    if (!hasSpaceSettingsFeature(space.id)) {
        throw new UnimplementedError("Space settings is not available");
    }

    const profileSettingsNavigation = hasProfileSettingsFeature(space.id) ? (
        <MobileSettingsRow
            icon={<Gear />}
            label="Profile"
            pressErrorTitle="Couldn’t open profile settings"
            onPress={async () => {
                await rootNavigate(`/s/${space.id}/settings/profile`);
            }}
        />
    ) : null;

    const notificationSettingsNavigation = hasNotificationSettingsFeature(space.id) ? (
        <MobileSettingsRow
            icon={<Envelope />}
            label="Notifications"
            pressErrorTitle="Couldn’t open notification settings"
            onPress={async () => {
                await rootNavigate(`/s/${space.id}/settings/notifications`);
            }}
        />
    ) : null;

    const userNavigation =
        profileSettingsNavigation || notificationSettingsNavigation ? (
            <>
                {profileSettingsNavigation}
                {notificationSettingsNavigation}
            </>
        ) : null;

    return (
        // NOTE: Since on `/more` we have "Space settings" in the title, "Space settings" makes
        // much more sense here.
        <SpaceRouteScrollView
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            title="Space settings"
        >
            <Box width="full" paddingX={screenPaddingX} maxWidth={maxWidth} marginX="center">
                {userNavigation}
                {userNavigation ? <Box marginY="2" /> : null}
                <MobileSettingsRow
                    withBorderTop
                    icon={<BuildingsIcon />}
                    label="General"
                    pressErrorTitle="Couldn’t open general settings"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/settings/general`);
                    }}
                />
                <MobileSettingsRow
                    icon={<Users />}
                    label="People"
                    pressErrorTitle="Couldn’t open people settings"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/settings/people`);
                    }}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}
