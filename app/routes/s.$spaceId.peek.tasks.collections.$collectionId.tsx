import TaskCollectionRoute from "~/app/routes/s.$spaceId.tasks.collections.$collectionId.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {
    meta,
    loader,
    shouldRevalidate,
} from "~/app/routes/s.$spaceId.tasks.collections.$collectionId.js";

export default function TaskCollectionPeekRoute() {
    return <TaskCollectionRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
