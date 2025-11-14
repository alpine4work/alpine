import {createMessageStreamSummarySections} from "~/client/messaging/internal/create_message_stream_summary_sections.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    MessageStreamReasoningPartPayload,
    MessageStreamToolCallPartPayload,
} from "~/shared/messaging/message_schema.js";

const documentId = generateId<DocumentId>();
const documentId2 = generateId<DocumentId>();
const documentId3 = generateId<DocumentId>();
const documentId4 = generateId<DocumentId>();
const documentId5 = generateId<DocumentId>();
describe("createMessageStreamSummarySections", () => {
    const baseMessageCreatedTime = new Date("2025-01-01T00:00:00.000Z");

    describe("empty stream parts", () => {
        test("creates a single empty Reasoning section when stream parts are empty", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 0,
                    isCompleted: true,
                    calls: [],
                },
            ]);
        });

        test("marks section as incomplete when thinking is not complete", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: false,
            });

            expect(sections[0]?.isCompleted).toBe(false);
        });
    });

    describe("single section scenarios", () => {
        test("creates a single Read section with one call", () => {
            const readPayload: MessageStreamToolCallPartPayload = {
                type: "ToolCall",
                call: {
                    type: "Read",
                    targetPath: `/documents/${documentId}`,
                    title: "File 1",
                },
            };

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: readPayload,
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Read",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
            ]);
        });

        test("creates a single Search section with one call", () => {
            const searchPayload: MessageStreamToolCallPartPayload = {
                type: "ToolCall",
                call: {
                    type: "Search",
                    query: "test query",
                },
            };

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: searchPayload,
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Search",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{query: "test query"}],
                },
            ]);
        });

        test("creates a single Reasoning section with one call", () => {
            const messageContent = createSimpleMessageContent("thinking...");
            const reasoningPayload: MessageStreamReasoningPartPayload = {
                type: "Reasoning",
                content: messageContent,
            };

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: reasoningPayload,
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 3000,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
            ]);
        });
    });

    describe("multiple calls in same section", () => {
        test("aggregates multiple Read calls in same section", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Read",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [
                        {targetPath: `/documents/${documentId}`, title: "File 1"},
                        {targetPath: `/documents/${documentId2}`, title: "File 2"},
                    ],
                },
            ]);
        });

        test("filters duplicate Read calls with same targetPath", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Read",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
            ]);
        });

        test("aggregates multiple Search calls in same section", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query1"},
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query2"},
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Search",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{query: "query1"}, {query: "query2"}],
                },
            ]);
        });

        test("aggregates multiple Reasoning calls in same section", () => {
            const messageContent1 = createSimpleMessageContent("thought 1");
            const messageContent2 = createSimpleMessageContent("thought 2");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent1,
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent2,
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{content: messageContent1}, {content: messageContent2}],
                },
            ]);
        });
    });

    describe("multiple sections with transitions", () => {
        test("creates separate sections when transitioning from Read to Search", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "test"},
                        },
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Read",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{query: "test"}],
                },
            ]);
        });

        test("creates separate sections when transitioning from Reasoning to Read", () => {
            const messageContent = createSimpleMessageContent("thinking");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent,
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    durationMs: 3000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
            ]);
        });

        test("creates three sections with multiple transitions", () => {
            const messageContent = createSimpleMessageContent("thinking");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent,
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "test"},
                        },
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 2"}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{query: "test"}],
                },
            ]);
        });
    });

    describe("completion state", () => {
        test("marks all sections as complete when thinking summary is complete", () => {
            const messageContent = createSimpleMessageContent("thinking");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent,
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
            ]);
        });

        test("marks only last section as incomplete when thinking summary is incomplete", () => {
            const messageContent = createSimpleMessageContent("thinking");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent,
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: false,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 0,
                    isCompleted: false,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
            ]);
        });

        test("sets duration to 0 for incomplete last section", () => {
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: false,
            });

            expect(sections).toEqual([
                {
                    type: "Read",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 0,
                    isCompleted: false,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
            ]);
        });
    });

    describe("duration calculations", () => {
        test("calculates duration from message created time for first section", () => {
            const messageContent = createSimpleMessageContent("thinking");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent,
                        },
                        createdTime: new Date("2025-01-01T00:00:10.500Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 10500,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
            ]);
        });

        test("calculates duration between sections correctly", () => {
            const messageContent = createSimpleMessageContent("thinking");
            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {
                            type: "Reasoning",
                            content: messageContent,
                        },
                        createdTime: new Date("2025-01-01T00:00:01.200Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:03.700Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1200,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.200Z"),
                    durationMs: 2500,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId2}`, title: "File 2"}],
                },
            ]);
        });
    });

    describe("complex multi-section scenarios", () => {
        test("handles many sections with varied durations when complete", () => {
            const messageContent1 = createSimpleMessageContent("initial thinking");
            const messageContent2 = createSimpleMessageContent("more thinking");
            const messageContent3 = createSimpleMessageContent("final thoughts");

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning section 1: 0s to 0.5s (500ms)
                    {
                        payload: {type: "Reasoning", content: messageContent1},
                        createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    },
                    // Read section: 0.5s to 2.3s (1800ms)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.300Z"),
                    },
                    // Search section: 2.3s to 4.7s (2400ms)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query1"},
                        },
                        createdTime: new Date("2025-01-01T00:00:03.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query2"},
                        },
                        createdTime: new Date("2025-01-01T00:00:04.700Z"),
                    },
                    // Reasoning section 2: 4.7s to 5.9s (1200ms)
                    {
                        payload: {type: "Reasoning", content: messageContent2},
                        createdTime: new Date("2025-01-01T00:00:05.900Z"),
                    },
                    // Read section 2: 5.9s to 8.1s (2200ms)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:08.100Z"),
                    },
                    // Reasoning section 3: 8.1s to 10s (1900ms)
                    {
                        payload: {type: "Reasoning", content: messageContent3},
                        createdTime: new Date("2025-01-01T00:00:10.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 500,
                    isCompleted: true,
                    calls: [{content: messageContent1}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    durationMs: 1800,
                    isCompleted: true,
                    calls: [
                        {targetPath: `/documents/${documentId}`, title: "File 1"},
                        {targetPath: `/documents/${documentId2}`, title: "File 2"},
                    ],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:02.300Z"),
                    durationMs: 2400,
                    isCompleted: true,
                    calls: [{query: "query1"}, {query: "query2"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:04.700Z"),
                    durationMs: 1200,
                    isCompleted: true,
                    calls: [{content: messageContent2}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:05.900Z"),
                    durationMs: 2200,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:08.100Z"),
                    durationMs: 1900,
                    isCompleted: true,
                    calls: [{content: messageContent3}],
                },
            ]);
        });

        test("handles many sections with incomplete last section", () => {
            const messageContent1 = createSimpleMessageContent("thinking 1");
            const messageContent2 = createSimpleMessageContent("thinking 2");

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning: 0s to 1s
                    {
                        payload: {type: "Reasoning", content: messageContent1},
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    // Read: 1s to 3s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                    // Search: 3s to 5s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "test"},
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                    // Reasoning (incomplete): 5s to ?
                    {
                        payload: {type: "Reasoning", content: messageContent2},
                        createdTime: new Date("2025-01-01T00:00:07.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: false,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent1}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [
                        {targetPath: `/documents/${documentId}`, title: "File 1"},
                        {targetPath: `/documents/${documentId2}`, title: "File 2"},
                    ],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{query: "test"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    durationMs: 0,
                    isCompleted: false,
                    calls: [{content: messageContent2}],
                },
            ]);
        });

        test("handles rapid section transitions with millisecond precision", () => {
            const messageContent1 = createSimpleMessageContent("quick thought 1");
            const messageContent2 = createSimpleMessageContent("quick thought 2");
            const messageContent3 = createSimpleMessageContent("quick thought 3");

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning: 0 to 50ms
                    {
                        payload: {type: "Reasoning", content: messageContent1},
                        createdTime: new Date("2025-01-01T00:00:00.050Z"),
                    },
                    // Read: 50ms to 150ms
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:00.150Z"),
                    },
                    // Reasoning: 150ms to 275ms
                    {
                        payload: {type: "Reasoning", content: messageContent2},
                        createdTime: new Date("2025-01-01T00:00:00.275Z"),
                    },
                    // Search: 275ms to 400ms
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "fast"},
                        },
                        createdTime: new Date("2025-01-01T00:00:00.400Z"),
                    },
                    // Reasoning: 400ms to 550ms
                    {
                        payload: {type: "Reasoning", content: messageContent3},
                        createdTime: new Date("2025-01-01T00:00:00.550Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 50,
                    isCompleted: true,
                    calls: [{content: messageContent1}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:00.050Z"),
                    durationMs: 100,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:00.150Z"),
                    durationMs: 125,
                    isCompleted: true,
                    calls: [{content: messageContent2}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:00.275Z"),
                    durationMs: 125,
                    isCompleted: true,
                    calls: [{query: "fast"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:00.400Z"),
                    durationMs: 150,
                    isCompleted: true,
                    calls: [{content: messageContent3}],
                },
            ]);
        });

        test("handles alternating sections with multiple calls per section", () => {
            const messageContent1 = createSimpleMessageContent("thought 1");
            const messageContent2 = createSimpleMessageContent("thought 2");
            const messageContent3 = createSimpleMessageContent("thought 3");

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning section with 2 calls: 0s to 2s
                    {
                        payload: {type: "Reasoning", content: messageContent1},
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {type: "Reasoning", content: messageContent2},
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    // Read section with 3 calls: 2s to 5s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:04.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                    // Search section with 4 calls: 5s to 9s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query1"},
                        },
                        createdTime: new Date("2025-01-01T00:00:06.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query2"},
                        },
                        createdTime: new Date("2025-01-01T00:00:07.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query3"},
                        },
                        createdTime: new Date("2025-01-01T00:00:08.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query4"},
                        },
                        createdTime: new Date("2025-01-01T00:00:09.000Z"),
                    },
                    // Reasoning section with 1 call: 9s to 10s
                    {
                        payload: {type: "Reasoning", content: messageContent3},
                        createdTime: new Date("2025-01-01T00:00:10.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 2000,
                    isCompleted: true,
                    calls: [{content: messageContent1}, {content: messageContent2}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    durationMs: 3000,
                    isCompleted: true,
                    calls: [
                        {targetPath: `/documents/${documentId}`, title: "File 1"},
                        {targetPath: `/documents/${documentId2}`, title: "File 2"},
                    ],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    durationMs: 4000,
                    isCompleted: true,
                    calls: [
                        {query: "query1"},
                        {query: "query2"},
                        {query: "query3"},
                        {query: "query4"},
                    ],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:09.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent3}],
                },
            ]);
        });

        test("handles long workflow with 8+ sections", () => {
            const messageContents = Array.from({length: 5}, (_, i) =>
                createSimpleMessageContent(`thought ${i + 1}`),
            );

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Section 1: Reasoning (0 to 0.5s)
                    {
                        payload: {type: "Reasoning", content: messageContents[0]!},
                        createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    },
                    // Section 2: Read (0.5s to 1.5s)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.500Z"),
                    },
                    // Section 3: Reasoning (1.5s to 2.5s)
                    {
                        payload: {type: "Reasoning", content: messageContents[1]!},
                        createdTime: new Date("2025-01-01T00:00:02.500Z"),
                    },
                    // Section 4: Search (2.5s to 3.5s)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query1"},
                        },
                        createdTime: new Date("2025-01-01T00:00:03.500Z"),
                    },
                    // Section 5: Read (3.5s to 4.5s)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:04.500Z"),
                    },
                    // Section 6: Reasoning (4.5s to 5.5s)
                    {
                        payload: {type: "Reasoning", content: messageContents[2]!},
                        createdTime: new Date("2025-01-01T00:00:05.500Z"),
                    },
                    // Section 7: Search (5.5s to 6.5s)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query2"},
                        },
                        createdTime: new Date("2025-01-01T00:00:06.500Z"),
                    },
                    // Section 8: Reasoning (6.5s to 7.5s)
                    {
                        payload: {type: "Reasoning", content: messageContents[3]!},
                        createdTime: new Date("2025-01-01T00:00:07.500Z"),
                    },
                    // Section 9: Read (7.5s to 8.5s)
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:08.500Z"),
                    },
                    // Section 10: Reasoning (8.5s to 9.5s)
                    {
                        payload: {type: "Reasoning", content: messageContents[4]!},
                        createdTime: new Date("2025-01-01T00:00:09.500Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 500,
                    isCompleted: true,
                    calls: [{content: messageContents[0]}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:01.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[1]}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:02.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{query: "query1"}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:03.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId2}`, title: "File 2"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:04.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[2]}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:05.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{query: "query2"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:06.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[3]}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:07.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:08.500Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[4]}],
                },
            ]);
        });

        test("handles incomplete workflow with many sections", () => {
            const messageContents = Array.from({length: 3}, (_, i) =>
                createSimpleMessageContent(`thought ${i + 1}`),
            );

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    {
                        payload: {type: "Reasoning", content: messageContents[0]!},
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    {
                        payload: {type: "Reasoning", content: messageContents[1]!},
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "test"},
                        },
                        createdTime: new Date("2025-01-01T00:00:04.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                    {
                        payload: {type: "Reasoning", content: messageContents[2]!},
                        createdTime: new Date("2025-01-01T00:00:06.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: false,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[0]}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "File 1"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[1]}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{query: "test"}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:04.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId2}`, title: "File 2"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    durationMs: 0,
                    isCompleted: false,
                    calls: [{content: messageContents[2]}],
                },
            ]);
        });

        test("handles section with many consecutive Read calls including duplicates", () => {
            const messageContent1 = createSimpleMessageContent("initial thinking");
            const messageContent2 = createSimpleMessageContent("final thinking");

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning: 0s to 1s
                    {
                        payload: {type: "Reasoning", content: messageContent1},
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    // Read section with 8 calls (some duplicates): 1s to 9s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:04.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId3}`,
                                title: "File 3",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:06.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId4}`,
                                title: "File 4",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:07.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId5}`,
                                title: "File 5",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:08.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId4}`,
                                title: "File 4",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:09.000Z"),
                    },
                    // Reasoning: 9s to 10s
                    {
                        payload: {type: "Reasoning", content: messageContent2},
                        createdTime: new Date("2025-01-01T00:00:10.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent1}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    durationMs: 8000,
                    isCompleted: true,
                    calls: [
                        {targetPath: `/documents/${documentId}`, title: "File 1"},
                        {targetPath: `/documents/${documentId2}`, title: "File 2"},
                        {targetPath: `/documents/${documentId3}`, title: "File 3"},
                        {targetPath: `/documents/${documentId4}`, title: "File 4"},
                        {targetPath: `/documents/${documentId5}`, title: "File 5"},
                    ],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:09.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContent2}],
                },
            ]);
        });

        test("handles section with many consecutive Search calls", () => {
            const messageContent = createSimpleMessageContent("analyzing results");

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning: 0s to 0.5s
                    {
                        payload: {type: "Reasoning", content: messageContent},
                        createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    },
                    // Search section with 10 calls: 0.5s to 10.5s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "authentication"},
                        },
                        createdTime: new Date("2025-01-01T00:00:01.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "user login"},
                        },
                        createdTime: new Date("2025-01-01T00:00:02.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "session management"},
                        },
                        createdTime: new Date("2025-01-01T00:00:03.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "JWT token"},
                        },
                        createdTime: new Date("2025-01-01T00:00:04.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "OAuth"},
                        },
                        createdTime: new Date("2025-01-01T00:00:05.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "password hashing"},
                        },
                        createdTime: new Date("2025-01-01T00:00:06.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "bcrypt"},
                        },
                        createdTime: new Date("2025-01-01T00:00:07.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "security headers"},
                        },
                        createdTime: new Date("2025-01-01T00:00:08.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "CORS policy"},
                        },
                        createdTime: new Date("2025-01-01T00:00:09.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "rate limiting"},
                        },
                        createdTime: new Date("2025-01-01T00:00:10.500Z"),
                    },
                    // Read section: 10.5s to 12s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "Auth File",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:12.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 500,
                    isCompleted: true,
                    calls: [{content: messageContent}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    durationMs: 10000,
                    isCompleted: true,
                    calls: [
                        {query: "authentication"},
                        {query: "user login"},
                        {query: "session management"},
                        {query: "JWT token"},
                        {query: "OAuth"},
                        {query: "password hashing"},
                        {query: "bcrypt"},
                        {query: "security headers"},
                        {query: "CORS policy"},
                        {query: "rate limiting"},
                    ],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:10.500Z"),
                    durationMs: 1500,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "Auth File"}],
                },
            ]);
        });

        test("handles workflow with mix of single and many consecutive calls per section", () => {
            const messageContents = Array.from({length: 4}, (_, i) =>
                createSimpleMessageContent(`thought ${i + 1}`),
            );

            const sections = createMessageStreamSummarySections({
                streamParts: [
                    // Reasoning with 1 call: 0s to 0.5s
                    {
                        payload: {type: "Reasoning", content: messageContents[0]!},
                        createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    },
                    // Read with 5 consecutive calls: 0.5s to 3s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "File 1",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId2}`,
                                title: "File 2",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:01.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId3}`,
                                title: "File 3",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId4}`,
                                title: "File 4",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:02.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId5}`,
                                title: "File 5",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    },
                    // Reasoning with 2 calls: 3s to 4s
                    {
                        payload: {type: "Reasoning", content: messageContents[1]!},
                        createdTime: new Date("2025-01-01T00:00:03.500Z"),
                    },
                    {
                        payload: {type: "Reasoning", content: messageContents[2]!},
                        createdTime: new Date("2025-01-01T00:00:04.000Z"),
                    },
                    // Search with 6 consecutive calls: 4s to 7s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query1"},
                        },
                        createdTime: new Date("2025-01-01T00:00:04.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query2"},
                        },
                        createdTime: new Date("2025-01-01T00:00:05.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query3"},
                        },
                        createdTime: new Date("2025-01-01T00:00:05.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query4"},
                        },
                        createdTime: new Date("2025-01-01T00:00:06.000Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query5"},
                        },
                        createdTime: new Date("2025-01-01T00:00:06.500Z"),
                    },
                    {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "query6"},
                        },
                        createdTime: new Date("2025-01-01T00:00:07.000Z"),
                    },
                    // Read with 1 call: 7s to 8s
                    {
                        payload: {
                            type: "ToolCall",
                            call: {
                                type: "Read",
                                targetPath: `/documents/${documentId}`,
                                title: "Final",
                            },
                        },
                        createdTime: new Date("2025-01-01T00:00:08.000Z"),
                    },
                    // Reasoning with 1 call: 8s to 9s
                    {
                        payload: {type: "Reasoning", content: messageContents[3]!},
                        createdTime: new Date("2025-01-01T00:00:09.000Z"),
                    },
                ],
                messageCreatedTime: baseMessageCreatedTime,
                isThinkingSummaryComplete: true,
            });

            expect(sections).toEqual([
                {
                    type: "Reasoning",
                    createdTime: baseMessageCreatedTime,
                    durationMs: 500,
                    isCompleted: true,
                    calls: [{content: messageContents[0]}],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:00.500Z"),
                    durationMs: 2500,
                    isCompleted: true,
                    calls: [
                        {targetPath: `/documents/${documentId}`, title: "File 1"},
                        {targetPath: `/documents/${documentId2}`, title: "File 2"},
                        {targetPath: `/documents/${documentId3}`, title: "File 3"},
                        {targetPath: `/documents/${documentId4}`, title: "File 4"},
                        {targetPath: `/documents/${documentId5}`, title: "File 5"},
                    ],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:03.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[1]}, {content: messageContents[2]}],
                },
                {
                    type: "Search",
                    createdTime: new Date("2025-01-01T00:00:04.000Z"),
                    durationMs: 3000,
                    isCompleted: true,
                    calls: [
                        {query: "query1"},
                        {query: "query2"},
                        {query: "query3"},
                        {query: "query4"},
                        {query: "query5"},
                        {query: "query6"},
                    ],
                },
                {
                    type: "Read",
                    createdTime: new Date("2025-01-01T00:00:07.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{targetPath: `/documents/${documentId}`, title: "Final"}],
                },
                {
                    type: "Reasoning",
                    createdTime: new Date("2025-01-01T00:00:08.000Z"),
                    durationMs: 1000,
                    isCompleted: true,
                    calls: [{content: messageContents[3]}],
                },
            ]);
        });
    });
});
