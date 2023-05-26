import {Outlet} from "react-router";
import {Box} from "~/client/design/box";
import {TasksSidebar} from "~/client/tasks/demo_2/tasks_sidebar";

export default function TasksLayoutRoute() {
    return (
        <Box flexGrow="1" overflow="hidden" display="flex">
            <TasksSidebar />
            <Box flexGrow="1" display="flex" flexDirection="column" overflow="hidden">
                <Outlet />
            </Box>
        </Box>
    );
}
