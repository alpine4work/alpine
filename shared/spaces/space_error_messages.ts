import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Error message we show when the user is signed in but doesn't have access to the
 * space they're trying to view.
 */
export const spaceAccessPermissionDeniedErrorDisplayMessage = errorDisplayMessage`You don\u2019t have access to this space. Try ${errorDisplayMessage.switchSpaceLink(
    "switching spaces",
)} or ${errorDisplayMessage.signOutLink("signing out")}.`;

/**
 * Error messages we show when the user doesn't have the expected role in a space.
 */
export const spaceAccessPermissionDeniedErrorDisplayMessageByExpectedRole: Record<
    SpaceRole,
    ErrorDisplayMessage
> = {
    Member: spaceAccessPermissionDeniedErrorDisplayMessage,
    Admin: errorDisplayMessage`You aren\u2019t an admin for this space. Ask an admin in this space to give you admin access.`,
    Owner: errorDisplayMessage`This action is restricted to the owner. You aren\u2019t an owner for this space.`,
};

/**
 * When a space isn't found, we treat it as permission denied.
 */
export function createSpaceNotFoundError(spaceId: string | undefined) {
    return new PermissionDeniedError("Account doesn\u2019t have access to space", {
        aggregateDedupeKey: spaceId,
        displayMessage: spaceAccessPermissionDeniedErrorDisplayMessage,
    });
}

export function createAuthorizeSpaceAccessPermissionDeniedError(
    spaceId: SpaceId,
    accountId: AccountId,
    expectedRole: SpaceRole = "Member",
) {
    const displayMessage =
        spaceAccessPermissionDeniedErrorDisplayMessageByExpectedRole[expectedRole];

    return new PermissionDeniedError(
        expectedRole === "Member"
            ? "Account doesn\u2019t have access to space"
            : quote`Account doesn\u2019t have ${expectedRole} access to space`,
        {
            aggregateDedupeKey: `${spaceId}:${accountId}`,
            displayMessage,
        },
    );
}
