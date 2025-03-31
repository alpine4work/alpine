import {ReactNode} from "react";
import {ChannelBrandIcon} from "~/client/icons/brand/channel_brand_icon.js";
import {ChatBrandIcon} from "~/client/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/icons/brand/document_brand_icon.js";
import {DocumentCommentBrandIcon} from "~/client/icons/brand/document_comment_brand_icon.js";
import {PostBrandIcon} from "~/client/icons/brand/post_brand_icon.js";
import {PostCommentBrandIcon} from "~/client/icons/brand/post_comment_brand_icon.js";
import {SearchFavoritesBrandIcon} from "~/client/icons/brand/search_favorites_brand_icon.js";
import {TaskBrandIcon} from "~/client/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/icons/brand/task_collection_brand_icon.js";
import {TaskCommentBrandIcon} from "~/client/icons/brand/task_comment_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/icons/brand/task_query_brand_icon.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    SearchDynamicEntityIdObject,
    SearchEntityId,
    parseSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";

/**
 * Configures how we display results of various types in `<SearchEntityView>`.
 *
 * - `name`: The name we present this search entity with.
 * - `isAccountMediaAuthor`: If the `SearchEntityModel` object has a `media`
 *   object with type `Account` then consider this account as the author of the
 *   search entity. Visually we end up putting the author name next to the
 *   search result body snippet to communicate authorship.
 */
export type SearchEntityTypeDisplay = {
    icon: ReactNode;
    isAccountMediaAuthor?: boolean;
};

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SpaceLayoutSideBarCreateButton/>`. If you change an icon here you
// should also change it there.
export function getSearchEntityTypeDisplay(entityId: SearchEntityId): SearchEntityTypeDisplay {
    switch (entityId) {
        case "CreateChatMessage": {
            return {icon: <ChatBrandIcon />};
        }
        case "CreatePost": {
            return {icon: <PostBrandIcon />};
        }
        case "CreateDocument": {
            return {icon: <DocumentBrandIcon />};
        }
        case "CreateTask": {
            return {icon: <TaskBrandIcon />};
        }
        case "CreateChannel": {
            return {icon: <ChannelBrandIcon />};
        }
        case "CreateTaskCollection": {
            return {icon: <TaskCollectionBrandIcon />};
        }
        case "CreateTaskView": {
            return {icon: <TaskQueryBrandIcon />};
        }
        case "TaskPersonal": {
            // Using the simpler single task icon for the personal task view instead of the
            // more advanced task collection icon or task view icon (which are technically
            // closer).
            return {icon: <TaskBrandIcon />};
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive":
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            return {icon: <TaskQueryBrandIcon />};
        }
        case "SearchFavorites": {
            return {icon: <SearchFavoritesBrandIcon />};
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
            return {icon: <ChatBrandIcon />};
        }
        case "Document": {
            return {icon: <DocumentBrandIcon />};
        }
        case "DocumentComment": {
            return {
                icon: <DocumentCommentBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "Channel": {
            return {icon: <ChannelBrandIcon />};
        }
        case "Post": {
            return {
                icon: <PostBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "PostComment": {
            return {
                icon: <PostCommentBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "Chat": {
            return {icon: <ChatBrandIcon />};
        }
        case "ChatMessage": {
            return {
                icon: <ChatBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "Task": {
            return {icon: <TaskBrandIcon />};
        }
        case "TaskCollection": {
            return {icon: <TaskCollectionBrandIcon />};
        }
        case "TaskComment": {
            return {icon: <TaskCommentBrandIcon />, isAccountMediaAuthor: true};
        }
        default:
            throw exhaustive(type);
    }
}
