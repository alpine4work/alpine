import {Box} from "~/client/web/design/box.js";
import {MobileSettingsRow} from "~/client/web/design/mobile_settings_row.js";
import {ChannelBrandIcon} from "~/client/web/icons/brand/channel_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/web/icons/brand/task_collection_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/web/icons/brand/task_query_brand_icon.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
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
                    pressErrorTitle="Couldn\u2019t create channel"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/channels/new`);
                    }}
                />
                <MobileSettingsRow
                    icon={<TaskCollectionBrandIcon />}
                    label="Task collection"
                    pressErrorTitle="Couldn\u2019t create task collection"
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
                    pressErrorTitle="Couldn\u2019t create task view"
                    onPress={async () => {
                        await rootNavigate(`/s/${space.id}/tasks/view`);
                    }}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}
