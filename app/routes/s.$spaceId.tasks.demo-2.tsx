import {Outlet, useLocation} from "react-router";
import {Box} from "~/client/design/box.js";
import {TaskLayoutTopBar} from "~/client/tasks/demo_2/task_layout_top_bar.js";

export default function TasksLayoutRoute() {
    const location = useLocation();

    return (
        // Strange format to override the `<SpaceLayoutTopBar>` bottom border with a
        // lighter color since our `<InboxView>` has a top bar of its own. We use a
        // lighter border so the two top bars look to be made of the same material.
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
                isNotepadTabActive={location.pathname.endsWith("/demo-2")}
                isCollectionsTabActive={location.pathname.includes("/collections/")}
                isViewsTabActive={location.pathname.endsWith("/view")}
            />
            <Outlet />
        </Box>
    );
}
