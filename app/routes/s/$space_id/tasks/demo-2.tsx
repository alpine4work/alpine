import {Outlet} from "react-router";
import {Box} from "~/client/design/box";
import {TaskSideBar} from "~/client/tasks/demo_2/task_side_bar";

export default function TasksLayoutRoute() {
    return (
        <Box flexGrow="1" overflow="hidden" display="flex">
            <TaskSideBar />
            <Box flexGrow="1" display="flex" flexDirection="column" overflow="hidden">
                <Outlet />
            </Box>
        </Box>
    );
}
