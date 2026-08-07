import {Box} from "~/client/web/design/box.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {CreateWidgetSecondaryMenuBar} from "~/client/web/spaces/layout/create_widget_secondary_menu_bar.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";

export function meta() {
    return [{title: `Create${metaTitlePostfix}`}];
}

export default function CreateMoreRoute() {
    const platform = usePlatform();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            title="Create"
            withoutDisappearingTitle={true}
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
        >
            <Box width="full" maxWidth={maxWidth} marginX="center">
                <CreateWidgetSecondaryMenuBar
                    headingType="Null"
                    maxWidth={maxWidth}
                    withRootNavigateToCreatedDocument={false}
                    withDocumentAndProjectTaskStartHereBadges={false}
                    withCreateVerbBeforeItemName={true}
                    onCloseWithAnimation={noop}
                    onCloseWithoutAnimation={noop}
                    onFocusPrimaryMenuBar={noop}
                />
            </Box>
        </SpaceRouteScrollView>
    );
}
