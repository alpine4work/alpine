import TaskCollectionRoute from "~/app/routes/s.$spaceId.tasks.collections.$collectionId.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {
    meta,
    loader,
    clientLoader,
    shouldRevalidate,
} from "~/app/routes/s.$spaceId.tasks.collections.$collectionId.js";

export default function TaskCollectionPeekRoute() {
    return <TaskCollectionRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
