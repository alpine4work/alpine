import {Box} from "~/client/design/box.js";
import {TaskCollectionViewHeader} from "~/client/tasks/internal/task_collection_view_header.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

export {newTaskCollectionNamePlaceholder} from "~/client/tasks/internal/task_collection_view_header.js";

export function TaskCollectionView({
    store,
    collectionId,
    collectionSubscription,
    createCollection,
}: {
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
    createCollection: (name: string) => Promise<void>;
}) {
    return (
        <Box flexGrow="1" width="full" overflow="hidden" backgroundColor="grey-0">
            <TaskCollectionViewHeader
                store={store}
                collectionId={collectionId}
                collectionSubscription={collectionSubscription}
                createCollection={createCollection}
            />
        </Box>
    );
}
