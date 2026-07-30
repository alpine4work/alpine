import {getFathomMeetingNotesCreatorAccountId} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_creator_account_id.js";
import {joshKnownAccountId} from "~/shared/accounts/known_account_ids.js";

const originalEnv = process.env;

afterEach(() => {
    process.env = originalEnv;
});

test("attributes meeting notes to Josh by default", () => {
    process.env = {...originalEnv};
    delete process.env.FATHOM_MEETING_NOTES_CREATOR_ACCOUNT_ID;

    expect(getFathomMeetingNotesCreatorAccountId()).toBe(joshKnownAccountId);
});

test("allows the local runner to override the meeting-notes creator", () => {
    process.env = {
        ...originalEnv,
        NODE_ENV: "development",
        FATHOM_MEETING_NOTES_CREATOR_ACCOUNT_ID: "27g6s1h4ygh1zqzw5h23gqtn88",
    };

    expect(getFathomMeetingNotesCreatorAccountId()).toBe("27g6s1h4ygh1zqzw5h23gqtn88");
});

test("ignores the local creator override in production", () => {
    process.env = {
        ...originalEnv,
        NODE_ENV: "production",
        FATHOM_MEETING_NOTES_CREATOR_ACCOUNT_ID: "27g6s1h4ygh1zqzw5h23gqtn88",
    };

    expect(getFathomMeetingNotesCreatorAccountId()).toBe(joshKnownAccountId);
});
