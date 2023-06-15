import {json} from "@remix-run/server-runtime";
import {useParams} from "react-router";
import {Box} from "~/client/design/box";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view";
import {useLocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {taskDetailPresentationalViewMaxWidth} from "~/client/tasks/demo_2/task_detail_presentational_view";
import {TaskView} from "~/client/tasks/demo_2/task_view";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

export function loader() {
    return json({});
}

export function meta() {}

export default function TaskRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const isInitialAppRender = useIsInitialAppRender();
    const taskId = Schema.id<LocalTaskId>().deserialize(useParams()["task_id"] ?? null);
    const [state, dispatch] = useLocalTasksState();

    if (isInitialAppRender) return null;

    return (
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="0"
            display="flex"
            justifyContent="center"
            padding={!withMobileLayout ? {desktop: "4"} : undefined}
        >
            <Box
                width="full"
                maxWidth={taskDetailPresentationalViewMaxWidth}
                overflowX="hidden"
                overflowY="scroll"
                borderRadius={!withMobileLayout ? {desktop: "md"} : undefined}
                boxShadow={!withMobileLayout ? {desktop: "elevation-5"} : undefined}
                backgroundColor="grey-0"
            >
                <TaskView
                    // Remount when the task ID changes.
                    key={taskId}
                    state={state}
                    dispatch={dispatch}
                    taskId={taskId}
                />
            </Box>
        </Box>
    );
}
