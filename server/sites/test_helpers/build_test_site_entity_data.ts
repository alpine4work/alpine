import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SearchEntityModelData} from "~/shared/search/search_entity_model.js";
import {
    SiteItemSearchEntityId,
    parseSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskTitleModel, createTaskTitleFromText} from "~/shared/tasks/title/task_title.js";

export function buildTestSiteEntityData(entityId: SiteItemSearchEntityId): SearchEntityModelData {
    const idObject = parseSiteItemSearchEntityId(entityId);

    switch (idObject.type) {
        case "Channel": {
            return {
                type: "Channel",
                title: "Test Entity",
                channel: {
                    id: idObject.channelId,
                    version: 0,
                },
            };
        }
        case "Document": {
            return {
                type: "Document",
                title: "Test Entity",
                document: {
                    id: idObject.documentId,
                    version: 0,
                },
            };
        }
        case "Chat": {
            return {
                type: "Chat",
                title: "Test Entity",
                chat: {
                    id: idObject.chatId,
                    version: 0,
                    media: {
                        type: "AccountPile",
                        previewAccounts: [AccountModel.getUnknown()],
                        accountCount: null,
                    },
                },
            };
        }
        case "Task": {
            const displayStatus = {
                displayStatus: "OpenActive",
                version: [0, 0],
            } as const;
            return {
                type: "Task",
                title: "Test Entity",
                task: {
                    id: idObject.taskId,
                    titleSnapshot: new TaskTitleModel(
                        createTaskTitleFromText("Test Entity"),
                    ).getSnapshot(),
                    displayStatus: {
                        value: displayStatus.displayStatus,
                        version: displayStatus.version,
                    },
                },
            };
        }
        case "TaskCollection": {
            return {
                type: "TaskCollection",
                title: "Test Entity",
                collection: {
                    id: idObject.collectionId,
                    titleVersion: [0, 0],
                    color: {
                        value: null,
                        version: [0, 0],
                    },
                },
            };
        }
        default:
            throw exhaustive(idObject);
    }
}
