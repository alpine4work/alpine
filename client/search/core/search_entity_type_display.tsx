import {ReactNode} from "react";
import {ClientBrandIcon} from "~/client/icons/brand/client_brand_icon.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    SearchDynamicEntityIdObject,
    SearchEntityId,
    SearchEntityType,
    parseSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";

/**
 * Configures how we display results of various types in `<SearchEntityView>`.
 *
 * - `name`: The name we present this search entity with.
 *
 * - `isAccountMediaAuthor`: If the `SearchEntityModel` object has a `media`
 *   object with type `Account` then consider this account as the author of the
 *   search entity. Visually we end up putting the author name next to the
 *   search result body snippet to communicate authorship.
 *
 * - `isPost`: Is this a post entity? Post entities shouldn't render their
 *   title and body at the same time (since the title duplicates content from
 *   the body) and we expect a post's body/title to always start with
 *   "in ${channelName}: " expecting the author name to be added in front.
 */
export type SearchEntityTypeDisplay = {
    type: SearchEntityType;
    icon: ReactNode;
    isAccountMediaAuthor?: boolean;
};

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SpaceLayoutSideBarCreateButton/>`. If you change an icon here you
// should also change it there.
export function getSearchEntityTypeDisplay(entityId: SearchEntityId): SearchEntityTypeDisplay {
    switch (entityId) {
        case "CreateChatMessage": {
            return {type: entityId, icon: <ClientBrandIcon iconType="Chat" />};
        }
        case "CreatePost": {
            return {type: entityId, icon: <ClientBrandIcon iconType="Post" />};
        }
        case "CreateDocument": {
            return {type: entityId, icon: <ClientBrandIcon iconType="Document" />};
        }
        case "CreateTask": {
            return {type: entityId, icon: <ClientBrandIcon iconType="Task" />};
        }
        case "CreateChannel": {
            return {type: entityId, icon: <ClientBrandIcon iconType="Channel" />};
        }
        case "CreateTaskCollection": {
            return {type: entityId, icon: <ClientBrandIcon iconType="TaskCollection" />};
        }
        case "CreateTaskView": {
            return {type: entityId, icon: <ClientBrandIcon iconType="TaskQuery" />};
        }
        case "TaskPersonal": {
            // Using the simpler single task icon for the personal task view instead of the
            // more advanced task collection icon or task view icon (which are technically
            // closer).
            return {type: entityId, icon: <ClientBrandIcon iconType="Task" />};
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive":
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            return {type: entityId, icon: <ClientBrandIcon iconType="TaskQuery" />};
        }
        case "SearchFavorites": {
            return {type: entityId, icon: <ClientBrandIcon iconType="SearchFavorites" />};
        }
        default: {
            const entityIdObject = parseSearchDynamicEntityId(entityId);
            return getSearchDynamicEntityTypeDisplay(entityIdObject.type);
        }
    }
}

export function getSearchDynamicEntityTypeDisplay(
    type: SearchDynamicEntityIdObject["type"],
): SearchEntityTypeDisplay {
    switch (type) {
        case "Account": {
            return {type, icon: <ClientBrandIcon iconType="Chat" />};
        }
        case "Document": {
            return {type, icon: <ClientBrandIcon iconType="Document" />};
        }
        case "DocumentComment": {
            return {
                type,
                icon: <ClientBrandIcon iconType="DocumentComment" />,
                isAccountMediaAuthor: true,
            };
        }
        case "Channel": {
            return {type, icon: <ClientBrandIcon iconType="Channel" />};
        }
        case "Post": {
            return {type, icon: <ClientBrandIcon iconType="Post" />, isAccountMediaAuthor: true};
        }
        case "PostComment": {
            return {
                type,
                icon: <ClientBrandIcon iconType="PostComment" />,
                isAccountMediaAuthor: true,
            };
        }
        case "Chat": {
            return {type, icon: <ClientBrandIcon iconType="Chat" />};
        }
        case "ChatMessage": {
            return {type, icon: <ClientBrandIcon iconType="Chat" />, isAccountMediaAuthor: true};
        }
        case "Task": {
            return {type, icon: <ClientBrandIcon iconType="Task" />};
        }
        case "TaskCollection": {
            return {type, icon: <ClientBrandIcon iconType="TaskCollection" />};
        }
        case "TaskComment": {
            return {
                type,
                icon: <ClientBrandIcon iconType="TaskComment" />,
                isAccountMediaAuthor: true,
            };
        }
        default:
            throw exhaustive(type);
    }
}
