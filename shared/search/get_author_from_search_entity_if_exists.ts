import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SearchEntityModelDataWithAccount} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function getAuthorFromSearchEntityIfExists(
    entity: SearchEntityModelDataWithAccount,
): AccountModel | null {
    switch (entity.type) {
        case "Account":
            // The author is the account that created a piece of content, used by mention
            // rendering to prefix titles like "Caleb: ". Accounts are people, not content
            // authored by themselves, so account entities do not have an author.
            return null;
        case "Channel":
        case "Chat":
        case "DatabaseTable":
        case "Document":
        case "Site":
        case "Static":
        case "Task":
        case "TaskCollection":
            return null;
        case "Post":
            return entity.post.author;
        case "DocumentComment":
        case "TaskComment":
        case "PostComment":
            return entity.comment.author;
        case "ChatMessage":
            return entity.message.author;
        default:
            throw exhaustive(entity);
    }
}
