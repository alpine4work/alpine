import TaskNotepadRoute from "~/app/routes/s.$spaceId.tasks._index.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader, clientLoader} from "~/app/routes/s.$spaceId.tasks._index.js";

export default function TaskNotepadPeekRoute() {
    return <TaskNotepadRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
