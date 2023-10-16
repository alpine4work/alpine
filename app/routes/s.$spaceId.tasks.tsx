import {useContext} from "react";
import {
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    Outlet,
    useRouteError,
} from "react-router";
import {Box} from "~/client/design/box.js";
import {SpaceRouteErrorRenderer} from "~/client/spaces/space_route_error_renderer.js";
import {TaskLayoutTopBar} from "~/client/tasks/task_layout_top_bar.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export default function TasksLayoutRoute() {
    const error = useRouteError();

    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));

    let isNotepadTabActive = false;
    let isCollectionsTabActive = false;
    let isViewsTabActive = false;
    let withoutBorderBottom = false;

    for (const match of dataRouterStateContext.matches) {
        if (match.route.id === "routes/s.$spaceId.tasks._index") {
            isNotepadTabActive = true;
            withoutBorderBottom = true;
        }

        if (match.route.id === "routes/s.$spaceId.tasks.collections.$collectionId") {
            isCollectionsTabActive = true;
            withoutBorderBottom = true;
        }

        if (match.route.id === "routes/s.$spaceId.tasks.view") {
            isViewsTabActive = true;
            withoutBorderBottom = false;
        }
    }

    // If we're rendering an error instead of the route, show a border bottom.
    if (error) withoutBorderBottom = false;

    return (
        // Strange format to override the `<SpaceLayoutTopBar>` bottom border with a
        // lighter color since our `<TasksLayoutRoute>` has a top bar of its own. We
        // use a lighter border so the two top bars look to be made of the same
        // material.
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="20"
            borderTop="grey-5"
            style={{height: "calc(100% + 1px)", marginTop: -1}}
            display="flex"
            flexDirection="column"
        >
            <TaskLayoutTopBar
                isNotepadTabActive={isNotepadTabActive}
                isCollectionsTabActive={isCollectionsTabActive}
                isViewsTabActive={isViewsTabActive}
                withoutBorderBottom={withoutBorderBottom}
            />
            {error !== undefined ? <SpaceRouteErrorRenderer error={error} /> : <Outlet />}
        </Box>
    );
}

// We use the same component for the error boundary so we don't remount the
// top bar if an error in a child component occurs.
//
// Making sure there's no remount on error requires careful patching to Remix
// and React Router.
export const ErrorBoundary = TasksLayoutRoute;
