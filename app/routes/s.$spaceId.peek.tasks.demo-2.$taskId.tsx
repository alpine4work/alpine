import TaskRoute from "~/app/routes/s.$spaceId.tasks.demo-2.$taskId.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader} from "~/app/routes/s.$spaceId.tasks.demo-2.$taskId.js";

export default function TaskPeekRoute() {
    return <TaskRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
