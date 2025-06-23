import {Users} from "phosphor-react";
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

export function meta() {
    return [{title: `Space settings${metaTitlePostfix}`}];
}

export default function MobileSpaceSettingsRoute() {
    if (process.env.NODE_ENV === "production")
        throw new UnimplementedError("Shouldn’t be able to open settings in production");

    const platform = usePlatform();
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const rootNavigate = useRootNavigate();

    // this route is accesible in desktop version as well so we give some max width for desktop
    // to make it look good.
    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        // NOTE: Since on `/more` we have "Space settings" in the title, "Space settings" makes
        // much more sense here.
        <SpaceRouteScrollView
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            title="Space settings"
        >
            <Box width="full" paddingX={screenPaddingX} maxWidth={maxWidth} marginX="center">
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
