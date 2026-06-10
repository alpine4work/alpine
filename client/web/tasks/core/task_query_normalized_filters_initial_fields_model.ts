import {CalendarDate} from "@internationalized/date";
import {TaskClientCollectionSubscription} from "~/client/web/tasks/core/task_client_collection_subscription.js";
import {TaskClientStoreCollectionEntry} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskTitleUpdateModel} from "~/shared/tasks/title/task_title.js";

export type TaskQueryNormalizedFiltersInitialFieldsModel = {
    readonly parentTaskSubscription: TaskClientTaskSubscription | null;
    readonly status: "Open" | "Closed";
    readonly collectionSubscriptionById: ReadonlyMap<
        TaskCollectionId,
        TaskClientCollectionSubscription
    >;
    readonly priority: TaskPriority | null;
    readonly layout: TaskLayout | null;
    readonly titleUpdate: TaskTitleUpdateModel | null;
    readonly assignee: AccountModel | null;
    readonly assigneeStatus: "Inactive" | "Active";
    readonly dueDate: CalendarDate | null;
    getReferencedCollectionEntryStore(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry>;
};
