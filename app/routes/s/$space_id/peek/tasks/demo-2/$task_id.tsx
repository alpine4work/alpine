import TaskRoute from "~/app/routes/s/$space_id/tasks/demo-2/$task_id";
import {usePeekContext} from "~/client/peek/peek_remix_embed";

export {meta, loader} from "~/app/routes/s/$space_id/tasks/demo-2/$task_id";

export default function TaskPeekRoute() {
    return <TaskRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
