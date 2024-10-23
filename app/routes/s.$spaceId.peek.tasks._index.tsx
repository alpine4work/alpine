import TaskNotepadRoute from "~/app/routes/s.$spaceId.tasks._index.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {meta, loader, shouldRevalidate} from "~/app/routes/s.$spaceId.tasks._index.js";

export default function TaskNotepadPeekRoute() {
    return <TaskNotepadRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
