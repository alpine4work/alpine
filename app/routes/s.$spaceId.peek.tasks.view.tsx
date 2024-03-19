import TaskViewRoute from "~/app/routes/s.$spaceId.tasks.view.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader, clientLoader} from "~/app/routes/s.$spaceId.tasks.view.js";

export default function TaskViewPeekRoute() {
    return <TaskViewRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
