import _Fuse from "fuse.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

/**
 * Search commands are consistent across all Alpine spaces. They're used for
 * quick navigation to some action or page.
 *
 * Some search commands accumulate affinity points. For example, `TaskPersonal`
 * exists both in `SearchCommandId` and `SearchAffinityId` because the task
 * personal view accumulates affinity points when you view it or add tasks
 * to it.
 */
export type SearchCommandId =
    | "CreateChatMessage"
    | "CreatePost"
    | "CreateChannel"
    | "CreateDocument"
    | "CreateTask"
    | "CreateTaskCollection"
    | "CreateTaskView"
    | "TaskPersonal"
    | "TaskQueryFilteredToCreatorIsCurrentAccount"
    | "TaskQueryFilteredToAssigneeIsCurrentAccount"
    | "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive"
    | "TaskQueryFilteredToAssignerIsCurrentAccount";

// Make sure there's no overlap between `SearchEntityId`s and
// `SearchCommandId`s.
assertEqualTypes<SearchEntityId & SearchCommandId, never>();

type SearchCommand = {
    readonly title: string;
    readonly otherHitTexts?: ReadonlyArray<string>;
};

const searchCommandById: {
    [Key in SearchCommandId]: SearchCommand;
} = {
    CreateChatMessage: {
        title: "Send chat message",
        otherHitTexts: [
            "chat message",
            "create chat message",
            "new chat message",
            "message",
            "send message",
            "create message",
            "new message",
            "chat",
            "send chat",
            "create chat",
            "new chat",
        ],
    },
    CreatePost: {
        title: "Create post",
        otherHitTexts: ["post", "new post"],
    },
    CreateChannel: {
        title: "Create channel",
        otherHitTexts: ["channel", "new channel"],
    },
    CreateDocument: {
        title: "Create document",
        otherHitTexts: ["document", "new document"],
    },
    CreateTask: {
        title: "Create task",
        otherHitTexts: ["task", "new task"],
    },
    CreateTaskCollection: {
        title: "Create task collection",
        otherHitTexts: [
            "task collection",
            "new task collection",
            "collection",
            "create collection",
            "new collection",
        ],
    },
    CreateTaskView: {
        title: "Create task view",
        otherHitTexts: ["all tasks", "create view", "task views", "new task view", "new view"],
    },
    TaskPersonal: {
        title: "My tasks",
        otherHitTexts: ["all tasks", "tasks", "my tasks"],
    },
    TaskQueryFilteredToCreatorIsCurrentAccount: {
        title: "Tasks I’ve created",
        otherHitTexts: [
            "all tasks",
            "my tasks",
            "tasks by me",
            "tasks created by me",
            "task views",
        ],
    },
    TaskQueryFilteredToAssigneeIsCurrentAccount: {
        title: "Tasks assigned to me",
        otherHitTexts: ["assigned tasks", "my tasks", "task views", "assigned to me"],
    },
    TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive: {
        title: "Active tasks assigned to me",
        otherHitTexts: [
            "assigned tasks",
            "active tasks",
            "my active tasks",
            "task views",
            "assigned to me",
        ],
    },
    TaskQueryFilteredToAssignerIsCurrentAccount: {
        title: "Tasks I’ve assigned to others",
        otherHitTexts: ["assigned tasks", "task views", "assigned to others"],
    },
};

/**
 * A lazy Fuse.js index for search commands. Used by our search implementation
 * to allow the user to take actions from the search modal.
 */
export const searchCommandIndex = new Lazy(() => {
    const commands: Array<{text: string; commandId: SearchCommandId; command: SearchCommand}> = [];

    for (const [commandId, command] of Object.entries(searchCommandById)) {
        commands.push({
            text: command.title,
            commandId: commandId as SearchCommandId,
            command,
        });

        for (const otherHitText of command.otherHitTexts ?? []) {
            commands.push({
                text: otherHitText,
                commandId: commandId as SearchCommandId,
                command,
            });
        }
    }

    return new Fuse(commands, {
        includeScore: true,
        // Must match more characters than "Create". Otherwise the user would see all
        // the create commands when typing "Create" all at once.
        minMatchCharLength: "Create".length + 1,
        keys: [{name: "text"}],
    });
});
