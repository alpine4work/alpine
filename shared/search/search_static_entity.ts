import _Fuse from "fuse.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {SearchStaticEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export type SearchStaticEntity = {
    readonly title: string;
    readonly media?: SearchEntityMediaModel;
    readonly otherHitTexts?: ReadonlyArray<string>;
};

export const searchStaticEntityById: {
    [Key in SearchStaticEntityId]: SearchStaticEntity;
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
        title: "Tasks I\u2019ve created",
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
        title: "Tasks I\u2019ve assigned to others",
        otherHitTexts: ["assigned tasks", "task views", "assigned to others"],
    },
    SearchFavorites: {
        title: "Favorites",
        otherHitTexts: ["shortcuts"],
    },
};

/**
 * A lazy Fuse.js index for static entities. Used by our search implementation to
 * allow the user to take actions from the search modal.
 */
export const searchStaticEntityIndex = new Lazy(() => {
    const entities: Array<{
        text: string;
        entityId: SearchStaticEntityId;
        entity: SearchStaticEntity;
    }> = [];

    for (const [entityId, entity] of Object.entries(searchStaticEntityById)) {
        entities.push({
            text: entity.title,
            entityId: entityId as SearchStaticEntityId,
            entity,
        });

        for (const otherHitText of entity.otherHitTexts ?? []) {
            entities.push({
                text: otherHitText,
                entityId: entityId as SearchStaticEntityId,
                entity,
            });
        }
    }

    return new Fuse(entities, {
        includeScore: true,
        // Must match more characters than "Create". Otherwise the user would see all the
        // create commands when typing "Create" all at once.
        minMatchCharLength: "Create".length + 1,
        keys: [{name: "text"}],
    });
});
