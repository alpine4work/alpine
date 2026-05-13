import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";

export const sitePermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren\u2019t allowed to access this site. Ask someone with access to share it with you.`,
    Comment: errorDisplayMessage`You aren\u2019t allowed to comment in this site. Ask someone who can share the site to give you comment access.`,
    Edit: errorDisplayMessage`You aren\u2019t allowed to post in this site. Ask someone who can share the site to give you post access.`,
    Manage: errorDisplayMessage`You aren\u2019t allowed to share this site. Ask someone who can share the site to give you share access.`,
};

export function createSiteNotFoundError(siteId: string | undefined) {
    return new NotFoundError("Site not found", {
        aggregateDedupeKey: siteId,
        displayMessage: errorDisplayMessage`This site doesn\u2019t exist. Try searching \u201Cmy sites\u201D to see sites you have access to.`,
    });
}

export function createSiteItemNotFoundError(siteId: string, siteItemId: string) {
    return new NotFoundError("Site item not found", {
        aggregateDedupeKey: `${siteId}-${siteItemId}`,
    });
}

export function createParentItemNotFoundError(siteId: string, itemId: string, parentId: string) {
    return new NotFoundError("Parent item not found", {
        aggregateDedupeKey: `${siteId}-${itemId}-${parentId}`,
    });
}
