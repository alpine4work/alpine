import {getFathomMeetingNotesMonthDocumentIds} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_month_document_ids.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const julyDocumentId = assertId<DocumentId>("11111111111111111111111111");
const juneDocumentId = assertId<DocumentId>("22222222222222222222222222");
const previousYearDocumentId = assertId<DocumentId>("33333333333333333333333333");

const content: ApiContent = {
    elements: [
        {
            type: "Heading",
            level: 2,
            elements: [{type: "Text", text: "2026"}],
        },
        {
            type: "Heading",
            level: 3,
            elements: [{type: "Text", text: "July"}],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Mention",
                    reference: {
                        type: "Document",
                        id: julyDocumentId,
                        title: "Tea Time - July 28, 2026",
                    },
                },
            ],
        },
        {
            type: "Heading",
            level: 3,
            elements: [{type: "Text", text: "June"}],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Mention",
                    reference: {
                        type: "Document",
                        id: juneDocumentId,
                        title: "Tea Time - June 30, 2026",
                    },
                },
            ],
        },
        {
            type: "Heading",
            level: 2,
            elements: [{type: "Text", text: "2025"}],
        },
        {
            type: "Heading",
            level: 3,
            elements: [{type: "Text", text: "July"}],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Mention",
                    reference: {
                        type: "Document",
                        id: previousYearDocumentId,
                        title: "Tea Time - July 29, 2025",
                    },
                },
            ],
        },
    ],
};

test("returns only mentions in the meeting month section", () => {
    expect(
        getFathomMeetingNotesMonthDocumentIds({
            content,
            scheduledStartTime: "2026-07-29T17:00:00Z",
        }),
    ).toEqual([julyDocumentId]);
});

test("uses the default time zone to choose the month section", () => {
    expect(
        getFathomMeetingNotesMonthDocumentIds({
            content,
            scheduledStartTime: "2026-07-01T02:00:00Z",
        }),
    ).toEqual([juneDocumentId]);
});
