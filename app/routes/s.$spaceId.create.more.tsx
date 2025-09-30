import {Box} from "~/client/design/box.js";
import {MobileSettingsRow} from "~/client/design/mobile_settings_row.js";
import {ChannelBrandIcon} from "~/client/icons/brand/channel_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/icons/brand/task_collection_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/icons/brand/task_query_brand_icon.js";
import {SpaceRouteScrollView} from "~/client/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {generateId} from "~/shared/id/id.js";

export function meta() {
    return [{title: `Create${metaTitlePostfix}`}];
}

export default function CreateMoreRoute() {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            title="Create"
            withoutDisappearingTitle={true}
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <MobileSettingsRow
                    withBorderTop
                    icon={<ChannelBrandIcon />}
                    label="Channel"
                    pressErrorTitle="Couldn’t create channel"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/channels/new`);
                    }}
                />
                <MobileSettingsRow
                    icon={<TaskCollectionBrandIcon />}
                    label="Task collection"
                    pressErrorTitle="Couldn’t create task collection"
                    onPress={async () => {
                        const collectionId = generateId();

                        await rootNavigate(
                            `/s/${space.id}/tasks/collections/${collectionId}?create`,
                        );
                    }}
                />
                <MobileSettingsRow
                    icon={<TaskQueryBrandIcon />}
                    label="Task view"
                    pressErrorTitle="Couldn’t create task view"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/tasks/view`);
                    }}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}
