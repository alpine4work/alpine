import {joshKnownAccountId} from "~/shared/accounts/known_account_ids.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Gets the account attributed as the creator of every meeting-notes document.
 */
export function getFathomMeetingNotesCreatorAccountId() {
    const configuredAccountId =
        process.env.NODE_ENV === "development"
            ? process.env.FATHOM_MEETING_NOTES_CREATOR_ACCOUNT_ID
            : undefined;
    return configuredAccountId === undefined
        ? joshKnownAccountId
        : assertId<AccountId>(configuredAccountId);
}
