import {CalendarDate} from "@internationalized/date";
import {TaskClientStoreCollectionEntry} from "~/client/tasks/core/task_client_store.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskTitleUpdateModel} from "~/shared/tasks/title/task_title.js";

export type TaskQueryNormalizedFiltersInitialFieldsModel = {
    readonly status: "Open" | "Closed";
    readonly collectionIds: ReadonlySet<TaskCollectionId>;
    readonly priority: TaskPriority | null;
    readonly titleUpdate: TaskTitleUpdateModel | null;
    readonly assignee: AccountModel | null;
    readonly assigneeStatus: "Inactive" | "Active";
    readonly dueDate: CalendarDate | null;
    getReferencedCollectionEntryStore(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry>;
};
