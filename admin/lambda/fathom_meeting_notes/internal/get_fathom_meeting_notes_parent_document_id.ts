import {assertId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const defaultFathomMeetingNotesParentDocumentId = assertId<DocumentId>(
    "ygfnxa6n51gcg07c3jx01vyqwc",
);

/**
 * Gets the document that indexes every Fathom meeting-notes document.
 */
export function getFathomMeetingNotesParentDocumentId() {
    const configuredDocumentId =
        process.env.NODE_ENV === "development"
            ? process.env.FATHOM_MEETING_NOTES_PARENT_DOCUMENT_ID
            : undefined;
    return configuredDocumentId === undefined
        ? defaultFathomMeetingNotesParentDocumentId
        : assertId<DocumentId>(configuredDocumentId);
}
