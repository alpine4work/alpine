import {
    PaginatedMessageList,
    PaginatedMessageListSegment,
} from "~/client/messaging/paginated_message_list";
import {InternalError} from "~/shared/error/error";

// The tests we write primarily exercise `loadFromStart()`. We run those tests
// a second time with `loadFromEnd()` which should behave the same way but in
// reverse.
const testSuites: Array<{
    name: string;
    loadFromStart: <Message extends {id: number}>(
        list: PaginatedMessageList<Message>,
        options: {
            afterMessageId: number | null;
            hasMoreMessagesAfter: boolean;
            messages: ReadonlyArray<Message>;
        },
    ) => PaginatedMessageList<Message>;
    loadFromEnd: <Message extends {id: number}>(
        list: PaginatedMessageList<Message>,
        options: {
            beforeMessageId: number | null;
            hasMoreMessagesBefore: boolean;
            messages: ReadonlyArray<Message>;
        },
    ) => PaginatedMessageList<Message>;
    getSegments: <Message extends {id: number}>(
        list: PaginatedMessageList<Message>,
    ) => ReadonlyArray<PaginatedMessageListSegment<Message>>;
}> = [
    {
        name: "loadFromStart",
        loadFromStart: (list, options) => list.loadFromStart(options),
        loadFromEnd: (list, options) => list.loadFromEnd(options),
        getSegments: list => list.getSegmentsForTest(),
    },
    {
        name: "loadFromEnd",
        loadFromStart: (list, options) =>
            list.loadFromEnd({
                beforeMessageId:
                    options.afterMessageId !== null ? 1000 - options.afterMessageId : null,
                hasMoreMessagesBefore: options.hasMoreMessagesAfter,
                messages: options.messages
                    .map(message => ({...message, id: 1000 - message.id}))
                    .reverse(),
            }),
        loadFromEnd: (list, options) =>
            list.loadFromStart({
                afterMessageId:
                    options.beforeMessageId !== null ? 1000 - options.beforeMessageId : null,
                hasMoreMessagesAfter: options.hasMoreMessagesBefore,
                messages: options.messages
                    .map(message => ({...message, id: 1000 - message.id}))
                    .reverse(),
            }),
        getSegments: list =>
            list
                .getSegmentsForTest()
                .map(segment => ({
                    messages: segment.messages
                        .map(message => ({...message, id: 1000 - message.id}))
                        .reverse(),
                    mayHaveMoreMessagesAfter: segment.mayHaveMoreMessagesBefore,
                    mayHaveMoreMessagesBefore: segment.mayHaveMoreMessagesAfter,
                }))
                .reverse(),
    },
];

for (const {name, loadFromStart, loadFromEnd, getSegments} of testSuites) {
    describe(`${name}`, () => {
        test("an empty list has no segments", () => {
            const list = PaginatedMessageList.empty();

            expect(getSegments(list)).toEqual([]);
        });

        test("messages must be in ascending id order", () => {
            const list = PaginatedMessageList.empty();

            expect(() =>
                loadFromStart(list, {
                    afterMessageId: null,
                    hasMoreMessagesAfter: true,
                    messages: [{id: 1}, {id: 3}, {id: 2}],
                }),
            ).toThrow(InternalError);
        });

        test("messages must start after the cursor", () => {
            const list = PaginatedMessageList.empty();

            expect(() =>
                loadFromStart(list, {
                    afterMessageId: 2,
                    hasMoreMessagesAfter: true,
                    messages: [{id: 2}, {id: 3}, {id: 4}],
                }),
            ).toThrow(InternalError);

            expect(() =>
                loadFromStart(list, {
                    afterMessageId: 3,
                    hasMoreMessagesAfter: true,
                    messages: [{id: 2}, {id: 3}, {id: 4}],
                }),
            ).toThrow(InternalError);

            expect(() =>
                loadFromStart(list, {
                    afterMessageId: 5,
                    hasMoreMessagesAfter: true,
                    messages: [{id: 2}, {id: 3}, {id: 4}],
                }),
            ).toThrow(InternalError);
        });

        test("can load normally", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [{id: 4}, {id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 6,
                hasMoreMessagesAfter: false,
                messages: [{id: 7}, {id: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1},
                        {id: 2},
                        {id: 3},
                        {id: 4},
                        {id: 5},
                        {id: 6},
                        {id: 7},
                        {id: 8},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load with no messages at the end", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [{id: 4}, {id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 6,
                hasMoreMessagesAfter: false,
                messages: [],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load and replace existing messages", () => {
            let list = PaginatedMessageList.empty<{id: number; test: number}>();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 1, test: 1},
                    {id: 2, test: 1},
                    {id: 3, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 1},
                    {id: 5, test: 1},
                    {id: 6, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 1},
                        {id: 5, test: 1},
                        {id: 6, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 2},
                    {id: 5, test: 2},
                    {id: 6, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 2},
                        {id: 5, test: 2},
                        {id: 6, test: 2},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("can load and delete existing messages at start", () => {
            let list = PaginatedMessageList.empty<{id: number; test: number}>();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 1, test: 1},
                    {id: 2, test: 1},
                    {id: 3, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 1},
                    {id: 5, test: 1},
                    {id: 6, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 1},
                        {id: 5, test: 1},
                        {id: 6, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 5, test: 2},
                    {id: 6, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 5, test: 2},
                        {id: 6, test: 2},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("can load and delete existing messages at middle", () => {
            let list = PaginatedMessageList.empty<{id: number; test: number}>();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 1, test: 1},
                    {id: 2, test: 1},
                    {id: 3, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 1},
                    {id: 5, test: 1},
                    {id: 6, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 1},
                        {id: 5, test: 1},
                        {id: 6, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 2},
                    {id: 6, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 2},
                        {id: 6, test: 2},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("can load and not delete existing messages at end", () => {
            let list = PaginatedMessageList.empty<{id: number; test: number}>();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 1, test: 1},
                    {id: 2, test: 1},
                    {id: 3, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 1},
                    {id: 5, test: 1},
                    {id: 6, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 1},
                        {id: 5, test: 1},
                        {id: 6, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 4, test: 2},
                    {id: 5, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1, test: 1},
                        {id: 2, test: 1},
                        {id: 3, test: 1},
                        {id: 4, test: 2},
                        {id: 5, test: 2},
                        {id: 6, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("will not update may have more messages when loading with less than what's in the segment", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: false,
                messages: [{id: 4}, {id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [{id: 4}, {id: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load normally in the middle of a list", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: 10,
                hasMoreMessagesAfter: true,
                messages: [{id: 11}, {id: 12}, {id: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 13,
                hasMoreMessagesAfter: true,
                messages: [{id: 14}, {id: 15}, {id: 16}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}, {id: 14}, {id: 15}, {id: 16}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 16,
                hasMoreMessagesAfter: false,
                messages: [{id: 17}, {id: 18}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 11},
                        {id: 12},
                        {id: 13},
                        {id: 14},
                        {id: 15},
                        {id: 16},
                        {id: 17},
                        {id: 18},
                    ],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load on top of messages loaded in the middle of a list", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: 10,
                hasMoreMessagesAfter: true,
                messages: [{id: 11}, {id: 12}, {id: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 13,
                hasMoreMessagesAfter: false,
                messages: [{id: 14}, {id: 15}, {id: 16}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}, {id: 14}, {id: 15}, {id: 16}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 8,
                hasMoreMessagesAfter: true,
                messages: [{id: 9}, {id: 10}, {id: 11}, {id: 12}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 9},
                        {id: 10},
                        {id: 11},
                        {id: 12},
                        {id: 13},
                        {id: 14},
                        {id: 15},
                        {id: 16},
                    ],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1},
                        {id: 2},
                        {id: 3},
                        {id: 9},
                        {id: 10},
                        {id: 11},
                        {id: 12},
                        {id: 13},
                        {id: 14},
                        {id: 15},
                        {id: 16},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("if loading a new segment with no more messages after it clears following segments", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: 30,
                hasMoreMessagesAfter: true,
                messages: [{id: 31}, {id: 32}, {id: 33}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 31}, {id: 32}, {id: 33}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 20,
                hasMoreMessagesAfter: false,
                messages: [{id: 21}, {id: 22}, {id: 23}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 21}, {id: 22}, {id: 23}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 10,
                hasMoreMessagesAfter: true,
                messages: [{id: 11}, {id: 12}, {id: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 21}, {id: 22}, {id: 23}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: false,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("if loading into an existing segment with no more messages after it clears following segments", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: 10,
                hasMoreMessagesAfter: true,
                messages: [{id: 11}, {id: 12}, {id: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 20,
                hasMoreMessagesAfter: true,
                messages: [{id: 21}, {id: 22}, {id: 23}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}, {id: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 21}, {id: 22}, {id: 23}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 11,
                hasMoreMessagesAfter: false,
                messages: [{id: 12}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 11}, {id: 12}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load multiple segments", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 6,
                hasMoreMessagesAfter: false,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge multiple segments when loading", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 6,
                hasMoreMessagesAfter: false,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [{id: 4}, {id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1},
                        {id: 2},
                        {id: 3},
                        {id: 4},
                        {id: 5},
                        {id: 6},
                        {id: 7},
                        {id: 8},
                        {id: 9},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge segment into the end of another segment when loading", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 6,
                hasMoreMessagesAfter: false,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [{id: 4}, {id: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge segment into the start of another segment when loading", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 6,
                hasMoreMessagesAfter: false,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 4,
                hasMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load from both ends simultaneously 1", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageId: null,
                hasMoreMessagesBefore: true,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 3,
                hasMoreMessagesAfter: true,
                messages: [{id: 4}, {id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1},
                        {id: 2},
                        {id: 3},
                        {id: 4},
                        {id: 5},
                        {id: 6},
                        {id: 7},
                        {id: 8},
                        {id: 9},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load from both ends simultaneously 2", () => {
            let list = PaginatedMessageList.empty();

            list = loadFromStart(list, {
                afterMessageId: null,
                hasMoreMessagesAfter: true,
                messages: [{id: 1}, {id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageId: null,
                hasMoreMessagesBefore: true,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 1}, {id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageId: 7,
                hasMoreMessagesBefore: true,
                messages: [{id: 4}, {id: 5}, {id: 6}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {id: 1},
                        {id: 2},
                        {id: 3},
                        {id: 4},
                        {id: 5},
                        {id: 6},
                        {id: 7},
                        {id: 8},
                        {id: 9},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });
    });
}
