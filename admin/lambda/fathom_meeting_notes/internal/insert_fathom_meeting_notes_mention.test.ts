import {insertFathomMeetingNotesMention} from "~/admin/lambda/fathom_meeting_notes/internal/insert_fathom_meeting_notes_mention.js";
import {ApiContentRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import type {DocumentId} from "~/shared/id/types/id_types.open_source.js";

const oldDocumentId = "old-document-id" as DocumentId;
const newDocumentId = "new-document-id" as DocumentId;

function summarizeContent(content: ApiContentRequest): Array<string> {
    return content.elements.map(element => {
        if (element.type === "Heading") {
            const text = element.elements
                .map(inlineElement => (inlineElement.type === "Text" ? inlineElement.text : ""))
                .join("");
            return `H${element.level}:${text}`;
        }

        if (element.type === "Paragraph") {
            const mention = element.elements.find(
                inlineElement => inlineElement.type === "Mention",
            );
            return mention?.type === "Mention" ? `P:${mention.reference.id}` : "P";
        }

        return element.type;
    });
}

test("adds the newest mention immediately after an existing month heading", () => {
    const content: ApiContentRequest = {
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
                            id: oldDocumentId,
                            title: "Tea Time - July 21, 2026",
                        },
                    },
                ],
            },
        ],
    };
    Object.freeze(content.elements);

    const result = insertFathomMeetingNotesMention({
        content,
        documentId: newDocumentId,
        scheduledStartTime: "2026-07-28T17:00:00Z",
    });

    expect({
        inserted: result.inserted,
        summary: summarizeContent(result.content),
    }).toEqual({
        inserted: true,
        summary: ["H2:2026", "H3:July", `P:${newDocumentId}`, `P:${oldDocumentId}`],
    });
});

test("allows a different document", () => {
    const content: ApiContentRequest = {
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
                            id: oldDocumentId,
                            title: "Tea Time - July 28, 2026",
                        },
                    },
                ],
            },
        ],
    };

    const result = insertFathomMeetingNotesMention({
        content,
        documentId: newDocumentId,
        scheduledStartTime: "2026-07-28T17:00:00Z",
    });

    expect({
        inserted: result.inserted,
        summary: summarizeContent(result.content),
    }).toEqual({
        inserted: true,
        summary: ["H2:2026", "H3:July", `P:${newDocumentId}`, `P:${oldDocumentId}`],
    });
});

test("returns the original content when the document is already mentioned", () => {
    const content: ApiContentRequest = {
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
                            id: oldDocumentId,
                            title: "Tea Time - July 28, 2026",
                        },
                    },
                ],
            },
        ],
    };

    const result = insertFathomMeetingNotesMention({
        content,
        documentId: oldDocumentId,
        scheduledStartTime: "2026-07-28T17:00:00Z",
    });

    expect(result).toEqual({content, inserted: false});
});

test("creates a missing month in descending chronological order", () => {
    const content: ApiContentRequest = {
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
                type: "Heading",
                level: 3,
                elements: [{type: "Text", text: "May"}],
            },
        ],
    };

    const result = insertFathomMeetingNotesMention({
        content,
        documentId: newDocumentId,
        scheduledStartTime: "2026-06-10T17:00:00Z",
    });

    expect(summarizeContent(result.content)).toEqual([
        "H2:2026",
        "H3:July",
        "H3:June",
        `P:${newDocumentId}`,
        "H3:May",
    ]);
});

test("creates a missing year in descending chronological order", () => {
    const content: ApiContentRequest = {
        elements: [
            {
                type: "Heading",
                level: 2,
                elements: [{type: "Text", text: "2026"}],
            },
            {
                type: "Heading",
                level: 3,
                elements: [{type: "Text", text: "January"}],
            },
            {
                type: "Heading",
                level: 2,
                elements: [{type: "Text", text: "2024"}],
            },
        ],
    };

    const result = insertFathomMeetingNotesMention({
        content,
        documentId: newDocumentId,
        scheduledStartTime: "2025-12-10T17:00:00Z",
    });

    expect(summarizeContent(result.content)).toEqual([
        "H2:2026",
        "H3:January",
        "H2:2025",
        "H3:December",
        `P:${newDocumentId}`,
        "H2:2024",
    ]);
});

test("uses the default time zone to choose the month section", () => {
    const content: ApiContentRequest = {
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
        ],
    };

    const result = insertFathomMeetingNotesMention({
        content,
        documentId: newDocumentId,
        scheduledStartTime: "2026-08-01T02:00:00Z",
    });

    expect(summarizeContent(result.content)).toEqual(["H2:2026", "H3:July", `P:${newDocumentId}`]);
});
