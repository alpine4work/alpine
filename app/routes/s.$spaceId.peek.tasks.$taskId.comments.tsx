import TaskCommentsRoute from "~/app/routes/s.$spaceId.tasks.$taskId.comments.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {meta, loader} from "~/app/routes/s.$spaceId.tasks.$taskId.comments.js";

export default function TaskCommentsPeekRoute() {
    return <TaskCommentsRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
