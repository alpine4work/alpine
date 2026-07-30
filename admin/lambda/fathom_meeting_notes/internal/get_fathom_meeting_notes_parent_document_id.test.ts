import {getFathomMeetingNotesParentDocumentId} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_parent_document_id.js";

const originalEnv = process.env;

afterEach(() => {
    process.env = originalEnv;
});

test("uses the production meeting-notes parent by default", () => {
    process.env = {...originalEnv};
    delete process.env.FATHOM_MEETING_NOTES_PARENT_DOCUMENT_ID;

    expect(getFathomMeetingNotesParentDocumentId()).toBe("ygfnxa6n51gcg07c3jx01vyqwc");
});

test("allows the local runner to override the meeting-notes parent", () => {
    process.env = {
        ...originalEnv,
        NODE_ENV: "development",
        FATHOM_MEETING_NOTES_PARENT_DOCUMENT_ID: "aq8h4ret7jxn8gkv3sm0ywc1dm",
    };

    expect(getFathomMeetingNotesParentDocumentId()).toBe("aq8h4ret7jxn8gkv3sm0ywc1dm");
});

test("ignores the local parent override in production", () => {
    process.env = {
        ...originalEnv,
        NODE_ENV: "production",
        FATHOM_MEETING_NOTES_PARENT_DOCUMENT_ID: "aq8h4ret7jxn8gkv3sm0ywc1dm",
    };

    expect(getFathomMeetingNotesParentDocumentId()).toBe("ygfnxa6n51gcg07c3jx01vyqwc");
});
