import {json} from "@remix-run/server-runtime";
import {useParams} from "react-router";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view";
// eslint-disable-next-line no-internal-imports
import {useLocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
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
        <SpaceRouteScrollView>
            <TaskView
                // Remount when the task ID changes.
                key={taskId}
                state={state}
                dispatch={dispatch}
                taskId={taskId}
            />
        </SpaceRouteScrollView>
    );
}
