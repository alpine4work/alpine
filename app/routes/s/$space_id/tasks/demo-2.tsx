import {Outlet} from "react-router";
import {Box} from "~/client/design/box";
import {TasksSideBar} from "~/client/tasks/demo_2/tasks_side_bar";

export default function TasksLayoutRoute() {
    return (
        <Box flexGrow="1" overflow="hidden" display="flex">
            <TasksSideBar />
            <Box flexGrow="1" display="flex" flexDirection="column" overflow="hidden">
                <Outlet />
            </Box>
        </Box>
    );
}
