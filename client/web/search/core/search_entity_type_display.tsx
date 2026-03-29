import {ReactNode} from "react";
import {ChannelBrandIcon} from "~/client/web/icons/brand/channel_brand_icon.js";
import {ChatBrandIcon} from "~/client/web/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/web/icons/brand/document_brand_icon.js";
import {DocumentCommentBrandIcon} from "~/client/web/icons/brand/document_comment_brand_icon.js";
import {PostBrandIcon} from "~/client/web/icons/brand/post_brand_icon.js";
import {PostCommentBrandIcon} from "~/client/web/icons/brand/post_comment_brand_icon.js";
import {SearchFavoritesBrandIcon} from "~/client/web/icons/brand/search_favorites_brand_icon.js";
import {TaskBrandIcon} from "~/client/web/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/web/icons/brand/task_collection_brand_icon.js";
import {TaskCommentBrandIcon} from "~/client/web/icons/brand/task_comment_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/web/icons/brand/task_query_brand_icon.js";
import {UnimplementedError} from "~/shared/error/error.js";
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
 * - `isAccountMediaAuthor`: If the `SearchEntityModel` object has a `media` object
 *   with type `Account` then consider this account as the author of the search
 *   entity. Visually we end up putting the author name next to the search result
 *   body snippet to communicate authorship.
 *
 * - `isPost`: Is this a post entity? Post entities shouldn't render their title
 *   and body at the same time (since the title duplicates content from the body)
 *   and we expect a post's body/title to always start with "in ${channelName}: "
 *   expecting the author name to be added in front.
 */
export type SearchEntityTypeDisplay = {
    type: SearchEntityType;
    icon: ReactNode;
    isAccountMediaAuthor?: boolean;
};

// NOTE(calebmer): The icons used here for create actions are the same icons used
// in `<SpaceLayoutSideBarCreateButton/>`. If you change an icon here you should
// also change it there.
export function getSearchEntityTypeDisplay(entityId: SearchEntityId): SearchEntityTypeDisplay {
    switch (entityId) {
        case "CreateChatMessage": {
            return {type: entityId, icon: <ChatBrandIcon />};
        }
        case "CreatePost": {
            return {type: entityId, icon: <PostBrandIcon />};
        }
        case "CreateDocument": {
            return {type: entityId, icon: <DocumentBrandIcon />};
        }
        case "CreateTask": {
            return {type: entityId, icon: <TaskBrandIcon />};
        }
        case "CreateChannel": {
            return {type: entityId, icon: <ChannelBrandIcon />};
        }
        case "CreateTaskCollection": {
            return {type: entityId, icon: <TaskCollectionBrandIcon />};
        }
        case "CreateTaskView": {
            return {type: entityId, icon: <TaskQueryBrandIcon />};
        }
        case "TaskPersonal": {
            // Using the simpler single task icon for the personal task view instead of the
            // more advanced task collection icon or task view icon (which are technically
            // closer).
            return {type: entityId, icon: <TaskBrandIcon />};
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive":
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            return {type: entityId, icon: <TaskQueryBrandIcon />};
        }
        case "SearchFavorites": {
            return {type: entityId, icon: <SearchFavoritesBrandIcon />};
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
            return {type, icon: <ChatBrandIcon />};
        }
        case "Document": {
            return {type, icon: <DocumentBrandIcon />};
        }
        case "DocumentComment": {
            return {type, icon: <DocumentCommentBrandIcon />, isAccountMediaAuthor: true};
        }
        case "Channel": {
            return {type, icon: <ChannelBrandIcon />};
        }
        case "Post": {
            return {type, icon: <PostBrandIcon />, isAccountMediaAuthor: true};
        }
        case "PostComment": {
            return {type, icon: <PostCommentBrandIcon />, isAccountMediaAuthor: true};
        }
        case "Chat": {
            return {type, icon: <ChatBrandIcon />};
        }
        case "ChatMessage": {
            return {type, icon: <ChatBrandIcon />, isAccountMediaAuthor: true};
        }
        case "Task": {
            return {type, icon: <TaskBrandIcon />};
        }
        case "TaskCollection": {
            return {type, icon: <TaskCollectionBrandIcon />};
        }
        case "TaskComment": {
            return {type, icon: <TaskCommentBrandIcon />, isAccountMediaAuthor: true};
        }
        case "Site": {
            // TODO(#sites): Create a SiteBrandIcon for this entity type
            throw new UnimplementedError("Site search entities aren\u2019t implemented");
        }
        default:
            throw exhaustive(type);
    }
}
