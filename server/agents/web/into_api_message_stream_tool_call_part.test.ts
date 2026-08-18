import {intoApiMessageStreamToolCallPart} from "~/server/agents/web/into_api_message_stream_tool_call_part.js";
import {agentToolAnnotations} from "~/shared/agents/agent_tool_annotations.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

test("creates a read tool call for a document", () => {
    const documentId = generateId<DocumentId>();

    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Read",
        pageLink: {type: "Document", id: documentId},
    });

    expect(toolCall).toEqual({
        content: {
            elements: [
                {type: "Text", text: "Reading "},
                {type: "Mention", reference: {type: "Document", id: documentId}},
            ],
        },
        annotations: agentToolAnnotations.read,
    });
});

test("creates a linked read tool call for a document comment thread", () => {
    const documentId = generateId<DocumentId>();
    const threadId = generateId<DocumentCommentThreadId>();

    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Read",
        pageLink: {
            type: "DocumentThread",
            document: {type: "Document", id: documentId},
            id: threadId,
        },
    });

    expect(toolCall).toEqual({
        content: {
            elements: [
                {type: "Text", text: "Reading "},
                {
                    type: "Text",
                    text: "comment thread",
                    marks: [
                        {
                            type: "Link",
                            url: `https://alpine.inc/doc/${documentId}?thread=${threadId}`,
                        },
                    ],
                },
                {type: "Text", text: " on "},
                {type: "Mention", reference: {type: "Document", id: documentId}},
            ],
        },
        annotations: agentToolAnnotations.read,
    });
});

test("does not create a read tool call for a task view", () => {
    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Read",
        pageLink: {type: "TaskView"},
    });

    expect(toolCall).toBeNull();
});

test("creates a search tool call", () => {
    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Search",
        query: "quarterly plan",
    });

    expect(toolCall).toEqual({
        content: {
            elements: [{type: "Text", text: "Searching \u201Cquarterly plan\u201D"}],
        },
        annotations: agentToolAnnotations.search,
    });
});

test("creates a linked tool call for a new document comment", () => {
    const documentId = generateId<DocumentId>();
    const threadId = generateId<DocumentCommentThreadId>();

    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Create",
        pageLink: {
            type: "DocumentThread",
            document: {type: "Document", id: documentId},
            id: threadId,
        },
    });

    expect(toolCall).toEqual({
        content: {
            elements: [
                {type: "Text", text: "Added "},
                {
                    type: "Text",
                    text: "a new comment",
                    marks: [
                        {
                            type: "Link",
                            url: `https://alpine.inc/doc/${documentId}?thread=${threadId}`,
                        },
                    ],
                },
                {type: "Text", text: " to "},
                {type: "Mention", reference: {type: "Document", id: documentId}},
                {type: "Text", text: "."},
            ],
        },
        annotations: agentToolAnnotations.create,
    });
});

test("creates a linked tool call for an updated task message", () => {
    const taskId = generateId<TaskId>();

    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Update",
        pageLink: {type: "TaskMessage", id: taskId, index: 3},
    });

    expect(toolCall).toEqual({
        content: {
            elements: [
                {type: "Text", text: "Updated "},
                {type: "Mention", reference: {type: "Task", id: taskId}},
                {type: "Text", text: " "},
                {
                    type: "Text",
                    text: "task message",
                    marks: [
                        {
                            type: "Link",
                            url: `https://alpine.inc/task/${taskId}?comment=3`,
                        },
                    ],
                },
                {type: "Text", text: "."},
            ],
        },
        annotations: agentToolAnnotations.update,
    });
});

test("does not create an update tool call for space settings", () => {
    const toolCall = intoApiMessageStreamToolCallPart({
        type: "Update",
        pageLink: {type: "Space"},
    });

    expect(toolCall).toBeNull();
});
