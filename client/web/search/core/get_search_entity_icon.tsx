import {ReactNode} from "react";
import {ChannelBrandIcon} from "~/client/web/icons/brand/channel_brand_icon.js";
import {ChatBrandIcon} from "~/client/web/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/web/icons/brand/document_brand_icon.js";
import {DocumentCommentBrandIcon} from "~/client/web/icons/brand/document_comment_brand_icon.js";
import {PostBrandIcon} from "~/client/web/icons/brand/post_brand_icon.js";
import {PostCommentBrandIcon} from "~/client/web/icons/brand/post_comment_brand_icon.js";
import {SearchFavoritesBrandIcon} from "~/client/web/icons/brand/search_favorites_brand_icon.js";
import {SiteBrandIcon} from "~/client/web/icons/brand/site_brand_icon.js";
import {TaskBrandIcon} from "~/client/web/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/web/icons/brand/task_collection_brand_icon.js";
import {TaskCommentBrandIcon} from "~/client/web/icons/brand/task_comment_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/web/icons/brand/task_query_brand_icon.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SearchEntityModelDataWithAccount} from "~/shared/search/search_entity_model.js";

// NOTE(calebmer): The icons used here for create actions are the same icons used
// in `<SpaceLayoutSideBarCreateButton/>`. If you change an icon here you should
// also change it there.
export function getSearchEntityIcon(entityData: SearchEntityModelDataWithAccount): ReactNode {
    if (entityData.type === "Static") return getSearchStaticEntityIcon(entityData);

    switch (entityData.type) {
        case "Account": {
            return <ChatBrandIcon />;
        }
        case "Document": {
            return <DocumentBrandIcon />;
        }
        case "DocumentComment": {
            return <DocumentCommentBrandIcon />;
        }
        case "Channel": {
            return <ChannelBrandIcon />;
        }
        case "Post": {
            return <PostBrandIcon />;
        }
        case "PostComment": {
            return <PostCommentBrandIcon />;
        }
        case "Chat": {
            return <ChatBrandIcon />;
        }
        case "ChatMessage": {
            return <ChatBrandIcon />;
        }
        case "Task": {
            return <TaskBrandIcon />;
        }
        case "TaskCollection": {
            return <TaskCollectionBrandIcon />;
        }
        case "TaskComment": {
            return <TaskCommentBrandIcon />;
        }
        case "Site": {
            return <SiteBrandIcon />;
        }
        default:
            throw exhaustive(entityData);
    }
}

export function getSearchStaticEntityIcon(
    entityData: SearchEntityModelDataWithAccount & {type: "Static"},
): ReactNode {
    switch (entityData.id) {
        case "CreateChatMessage": {
            return <ChatBrandIcon />;
        }
        case "CreatePost": {
            return <PostBrandIcon />;
        }
        case "CreateDocument": {
            return <DocumentBrandIcon />;
        }
        case "CreateTask": {
            return <TaskBrandIcon />;
        }
        case "CreateChannel": {
            return <ChannelBrandIcon />;
        }
        case "CreateTaskCollection": {
            return <TaskCollectionBrandIcon />;
        }
        case "CreateTaskView": {
            return <TaskQueryBrandIcon />;
        }
        case "TaskPersonal": {
            // Using the simpler single task icon for the personal task view instead of the
            // more advanced task collection icon or task view icon (which are technically
            // closer).
            return <TaskBrandIcon />;
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive":
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            return <TaskQueryBrandIcon />;
        }
        case "SearchFavorites": {
            return <SearchFavoritesBrandIcon />;
        }
        default: {
            throw exhaustive(entityData.id);
        }
    }
}
