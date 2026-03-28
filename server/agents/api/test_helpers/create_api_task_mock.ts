import {
    ApiAccountMockOptions,
    createApiAccountMock,
} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {parseApiContentResponseFromMarkdownForTest} from "~/shared/api/content/test_helpers/parse_api_content_response_from_markdown_for_test.js";
import {
    ApiAccountResponse,
    ApiContentResponse,
    ApiTaskCollectionItemResponse,
    ApiTaskDue,
    ApiTaskLayout,
    ApiTaskNotesResponse,
    ApiTaskParentResponse,
    ApiTaskPriority,
    ApiTaskResponse,
    ApiTaskStatus,
    ApiTaskSubtasks,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {scrambleBytes} from "~/shared/helpers/binary/scramble_bytes.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {WritableShallow} from "~/shared/helpers/types/writable_deep.js";
import {encodeId, generateId, idByteLength} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

export type ApiTaskStatusMock = "Open" | "OpenInactive" | "OpenActive" | "Closed";

export function createApiTaskMockStatus(status: ApiTaskStatusMock): ApiTaskStatus {
    switch (status) {
        case "Open":
            return {type: "Open", isActive: false};
        case "OpenInactive":
            return {type: "Open", isActive: false};
        case "OpenActive":
            return {type: "Open", isActive: true};
        case "Closed":
            return {type: "Closed"};
        default:
            throw exhaustive(status);
    }
}

export type ApiTaskMockOptions = {
    index?: number;
    id?: TaskId;
    title?: string;
    status?: ApiTaskStatusMock | ApiTaskStatus;
    assignee?: ApiAccountMockOptions | ApiAccountResponse;
    due?: ApiTaskDue["date"] | ApiTaskDue;
    priority?: ApiTaskPriority["type"] | ApiTaskPriority;
    layout?: ApiTaskLayout["type"] | ApiTaskLayout;
    parent?:
        | Replace<
              Partial<ApiTaskParentResponse["task"]>,
              {index?: number; status?: ApiTaskStatusMock | ApiTaskStatus}
          >
        | ApiTaskParentResponse;
    collections?: ReadonlyArray<
        | TaskCollectionId
        | Partial<ApiTaskCollectionItemResponse["collection"]>
        | ApiTaskCollectionItemResponse
    >;
    subtasks?: Partial<ApiTaskSubtasks>;
    notes?: string | ApiContentResponse | ApiTaskNotesResponse;
};

export function createApiTaskMock({
    index,
    id = typeof index === "number" ? createApiTaskIdMock(index) : generateId<TaskId>(),
    title = typeof index === "number" ? `Test Task ${index}` : "Test Task",
    status = {type: "Open", isActive: false},
    assignee,
    due,
    priority,
    layout,
    parent,
    collections,
    subtasks,
    notes,
}: ApiTaskMockOptions): ApiTaskResponse {
    const task: WritableShallow<ApiTaskResponse> = {
        id,
        title,
        status: typeof status === "string" ? createApiTaskMockStatus(status) : status,

        collections: (collections ?? []).map(collection => {
            if (typeof collection === "string") {
                return {collection: {id: collection, name: "Test Task Collection"}};
            }

            if ("collection" in collection) {
                return collection;
            }

            return {
                collection: {
                    id: collection.id ?? generateId<TaskCollectionId>(),
                    name: collection.name ?? "Test Task Collection",
                },
            };
        }),

        subtasks: {
            openTaskCount: subtasks?.openTaskCount ?? 0,
            closedTaskCount: subtasks?.closedTaskCount ?? 0,
        },

        notes:
            notes === undefined
                ? {version: 0, content: {elements: []}}
                : typeof notes === "string"
                  ? {version: 0, content: parseApiContentResponseFromMarkdownForTest(notes)}
                  : "elements" in notes
                    ? {version: 0, content: notes}
                    : notes,
    };

    if (assignee !== undefined) {
        task.assignee = "space" in assignee ? assignee : createApiAccountMock(assignee);
    }

    if (due !== undefined) {
        task.due = typeof due === "string" ? {date: due} : due;
    }

    if (priority !== undefined) {
        task.priority = typeof priority === "string" ? {type: priority} : priority;
    }

    if (layout !== undefined) {
        task.layout = typeof layout === "string" ? {type: layout} : layout;
    }

    if (parent !== undefined) {
        task.parent =
            "task" in parent
                ? parent
                : {
                      task: {
                          id:
                              parent.id ??
                              (typeof parent.index === "number"
                                  ? createApiTaskIdMock(parent.index)
                                  : generateId<TaskId>()),
                          title:
                              parent.title ??
                              (typeof parent.index === "number"
                                  ? `Test Task ${parent.index}`
                                  : "Test Task"),
                          status:
                              parent.status !== undefined
                                  ? typeof parent.status === "string"
                                      ? createApiTaskMockStatus(parent.status)
                                      : parent.status
                                  : {type: "Open", isActive: false},
                      },
                  };
    }

    return task;
}

export function createApiTaskIdMock(index: number): TaskId {
    const bytes = new Uint8Array(idByteLength);

    // "task" in ASCII
    bytes[0] = 0x74;
    bytes[1] = 0x61;
    bytes[2] = 0x73;
    bytes[3] = 0x6b;

    const view = new DataView(bytes.buffer);
    view.setUint32(4, index);

    return encodeId(scrambleBytes(bytes, 0x7461736b));
}
