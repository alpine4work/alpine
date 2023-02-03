import {
    PaginatedMessageList,
    maxMessageIndex,
    minMessageIndex,
} from "~/client/messaging/paginated_message_list";
import {InternalError} from "~/shared/error/error";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";

test("can load into an empty list", () => {
    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, messageCount: 100}])
            .loadMessages({
                afterMessageIndex: 19,
                beforeMessageIndex: 30,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 20},
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 20},
        {
            isLoaded: true,
            messages: [
                {index: 20},
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
            ],
        },
        {isLoaded: false, messageCount: 70},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, messageCount: 101}])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 70},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, messageCount: 100}])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 21},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, messageCount: 100}])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);
});

test("can load into an empty list with no estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);
});

test("can load in the middle of an unloaded segment when there is one loaded segment at the start", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 0}]},
            {isLoaded: false, messageCount: 100},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{index: 0}]},
        {isLoaded: false, messageCount: 20},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 70},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 0}]},
            {isLoaded: false, messageCount: 100},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 70},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 0}]},
            {isLoaded: false, messageCount: 100},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{index: 0}]},
        {isLoaded: false, messageCount: 20},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 0}]},
            {isLoaded: false, messageCount: 100},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);
});

test("can load in the middle of an unloaded segment when there is one loaded segment at the end", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 101},
            {isLoaded: true, messages: [{index: 101}]},
        ])
            .loadMessages({
                afterMessageIndex: 19,
                beforeMessageIndex: 30,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 20},
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 20},
        {
            isLoaded: true,
            messages: [
                {index: 20},
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
            ],
        },
        {isLoaded: false, messageCount: 71},
        {isLoaded: true, messages: [{index: 101}]},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 101},
            {isLoaded: true, messages: [{index: 101}]},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 70},
        {isLoaded: true, messages: [{index: 101}]},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 101},
            {isLoaded: true, messages: [{index: 101}]},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 21},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 101},
            {isLoaded: true, messages: [{index: 101}]},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
    ]);
});

test("can load in the middle of an unloaded segment at the beginning with deleted messages", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 100},
            {isLoaded: true, messages: [{index: 101}]},
        ])
            .loadMessages({
                afterMessageIndex: 19,
                beforeMessageIndex: 30,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 20}, {index: 21}, {index: 23}, {index: 25}, {index: 27}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 21},
        {
            isLoaded: true,
            messages: [{index: 20}, {index: 21}, {index: 23}, {index: 25}, {index: 27}],
        },
        {isLoaded: false, messageCount: 74},
        {isLoaded: true, messages: [{index: 101}]},
    ]);
});

test("can load in the middle of an unbalanced unloaded segment", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 0}]},
            {isLoaded: false, messageCount: 70},
            {isLoaded: true, messages: [{index: 100}]},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 21},
                    {index: 22},
                    {index: 23},
                    {index: 24},
                    {index: 25},
                    {index: 26},
                    {index: 27},
                    {index: 28},
                    {index: 29},
                    {index: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{index: 0}]},
        {isLoaded: false, messageCount: 13},
        {
            isLoaded: true,
            messages: [
                {index: 21},
                {index: 22},
                {index: 23},
                {index: 24},
                {index: 25},
                {index: 26},
                {index: 27},
                {index: 28},
                {index: 29},
                {index: 30},
            ],
        },
        {isLoaded: false, messageCount: 47},
        {isLoaded: true, messages: [{index: 100}]},
    ]);
});

test("can load in the middle of an unbalanced unloaded segment with deleted messages", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 0}]},
            {isLoaded: false, messageCount: 70},
            {isLoaded: true, messages: [{index: 100}]},
        ])
            .loadMessages({
                afterMessageIndex: 20,
                beforeMessageIndex: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 21}, {index: 23}, {index: 25}, {index: 27}, {index: 29}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{index: 0}]},
        {isLoaded: false, messageCount: 15},
        {
            isLoaded: true,
            messages: [{index: 21}, {index: 23}, {index: 25}, {index: 27}, {index: 29}],
        },
        {isLoaded: false, messageCount: 50},
        {isLoaded: true, messages: [{index: 100}]},
    ]);
});

test("when merging will decrease next unloaded segment estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 9,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 10}, {index: 11}, {index: 12}, {index: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [{index: 8}, {index: 9}, {index: 10}, {index: 11}, {index: 12}, {index: 13}],
        },
        {isLoaded: false, messageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 9,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 10}, {index: 11}, {index: 12}, {index: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 10},
        {
            isLoaded: true,
            messages: [{index: 8}, {index: 9}, {index: 10}, {index: 11}, {index: 12}, {index: 13}],
        },
        {isLoaded: false, messageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 9,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 10}, {index: 11}, {index: 12}, {index: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 10},
        {
            isLoaded: true,
            messages: [{index: 8}, {index: 9}, {index: 10}, {index: 11}, {index: 12}, {index: 13}],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 9,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 10}, {index: 11}, {index: 12}, {index: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [{index: 8}, {index: 9}, {index: 10}, {index: 11}, {index: 12}, {index: 13}],
        },
        {isLoaded: false, messageCount: 1},
    ]);
});

test("when merging will decrease last unloaded segment estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 7},
        {
            isLoaded: true,
            messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}, {index: 9}, {index: 10}],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 7},
        {
            isLoaded: true,
            messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}, {index: 9}, {index: 10}],
        },
        {isLoaded: false, messageCount: 10},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}, {index: 9}, {index: 10}],
        },
        {isLoaded: false, messageCount: 10},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [{index: 5}, {index: 6}, {index: 7}, {index: 8}, {index: 9}, {index: 10}],
        },
    ]);
});

test("when merging will decrease next and last unloaded segment estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 7},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 7},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);
});

test("when merging will decrease next and last unloaded segment estimated message count in an unbalanced way", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 6,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 9},
        {
            isLoaded: true,
            messages: [
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 6,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 6,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 6,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                    {index: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 9},
        {
            isLoaded: true,
            messages: [
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
                {index: 12},
                {index: 13},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 7},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
            ],
        },
        {isLoaded: false, messageCount: 9},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 1},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
            ],
        },
        {isLoaded: false, messageCount: 9},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 7},
        {
            isLoaded: true,
            messages: [
                {index: 5},
                {index: 6},
                {index: 7},
                {index: 8},
                {index: 9},
                {index: 10},
                {index: 11},
            ],
        },
        {isLoaded: false, messageCount: 1},
    ]);
});

test("when merging will decrease estimated message count only by new messages", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
            {isLoaded: false, messageCount: 10},
        ])
            .loadMessages({
                afterMessageIndex: 8,
                beforeMessageIndex: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 10}, {index: 12}, {index: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [{index: 8}, {index: 10}, {index: 12}, {index: 13}],
        },
        {isLoaded: false, messageCount: 8},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, messageCount: 10},
            {isLoaded: true, messages: [{index: 8}, {index: 9}, {index: 10}]},
        ])
            .loadMessages({
                afterMessageIndex: 4,
                beforeMessageIndex: 10,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{index: 5}, {index: 6}, {index: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, messageCount: 8},
        {
            isLoaded: true,
            messages: [{index: 5}, {index: 6}, {index: 8}, {index: 10}],
        },
    ]);
});

test("can load nothing into an empty list", () => {
    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageIndex: 0,
                beforeMessageIndex: Number.MAX_SAFE_INTEGER,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [],
            })
            .getSegmentsForTest(),
    ).toEqual([]);
});

// NOTE(calebmer, 2023-01-24): This test harness was written when
// `PaginatedMessageList` had a different API. Keeping these tests because they
// cover the file well but the test harness is a little weird because of
// that change.
type TestSuite = {
    name: string;
    loadFromStart: <Message extends {index: number}>(
        list: PaginatedMessageList<Message>,
        options: {
            afterMessageIndex: number | null;
            hasMoreMessagesAfter: boolean;
            messages: ReadonlyArray<Message>;
        },
    ) => PaginatedMessageList<Message>;
    loadFromEnd: <Message extends {index: number}>(
        list: PaginatedMessageList<Message>,
        options: {
            beforeMessageIndex: number | null;
            hasMoreMessagesBefore: boolean;
            messages: ReadonlyArray<Message>;
        },
    ) => PaginatedMessageList<Message>;
    getSegments: <Message extends {index: number}>(
        list: PaginatedMessageList<Message>,
    ) => ReadonlyArray<{
        messages: ReadonlyArray<Message>;
        mayHaveMoreMessagesBefore: boolean;
        mayHaveMoreMessagesAfter: boolean;
    }>;
};

const loadFromStartTestSuite: TestSuite = {
    name: "loadFromStart",
    loadFromStart: (list, options) => {
        const afterMessageIndex = options.afterMessageIndex ?? minMessageIndex - 1;
        return list.loadMessages({
            afterMessageIndex,
            beforeMessageIndex:
                (options.messages[options.messages.length - 1]?.index ?? afterMessageIndex) + 1,
            mayHaveMoreMessagesBefore: options.afterMessageIndex !== null,
            mayHaveMoreMessagesAfter: options.hasMoreMessagesAfter,
            messages: options.messages,
        });
    },
    loadFromEnd: (list, options) => {
        const beforeMessageIndex = options.beforeMessageIndex ?? maxMessageIndex + 1;
        return list.loadMessages({
            afterMessageIndex: (options.messages[0]?.index ?? beforeMessageIndex) - 1,
            beforeMessageIndex,
            mayHaveMoreMessagesBefore: options.hasMoreMessagesBefore,
            mayHaveMoreMessagesAfter: options.beforeMessageIndex !== null,
            messages: options.messages,
        });
    },
    getSegments: list => {
        // Every time we call `getSegments()` also run a test on `getMessage()` and
        // `getIndexByMessageId()` to make sure they behave correctly.
        for (const {index, message} of list.iterateMessagesForTest()) {
            expect(list.getMessage(index)).toEqual({isLoaded: true, message});
        }

        const segments = list.getSegmentsForTest();
        return Array.from(
            filterMapIterable(segments, (segment, index) => {
                if (!segment.isLoaded) return null;
                return {
                    messages: segment.messages,
                    mayHaveMoreMessagesBefore: !!segments[index - 1],
                    mayHaveMoreMessagesAfter: !!segments[index + 1],
                };
            }),
        );
    },
};

const testSuites: Array<TestSuite> = [
    loadFromStartTestSuite,
    {
        name: "loadFromEnd",
        loadFromStart: (list, options) =>
            loadFromStartTestSuite.loadFromEnd(list, {
                beforeMessageIndex:
                    options.afterMessageIndex !== null ? 1000 - options.afterMessageIndex : null,
                hasMoreMessagesBefore: options.hasMoreMessagesAfter,
                messages: options.messages
                    .map(message => ({...message, index: 1000 - message.index}))
                    .reverse(),
            }),
        loadFromEnd: (list, options) =>
            loadFromStartTestSuite.loadFromStart(list, {
                afterMessageIndex:
                    options.beforeMessageIndex !== null ? 1000 - options.beforeMessageIndex : null,
                hasMoreMessagesAfter: options.hasMoreMessagesBefore,
                messages: options.messages
                    .map(message => ({...message, index: 1000 - message.index}))
                    .reverse(),
            }),
        getSegments: list =>
            loadFromStartTestSuite
                .getSegments(list)
                .map(segment => ({
                    messages: segment.messages
                        .map(message => ({...message, index: 1000 - message.index}))
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
            const list = PaginatedMessageList.new(0);

            expect(getSegments(list)).toEqual([]);
        });

        test("messages must be in ascending id order", () => {
            const list = PaginatedMessageList.new(8);

            expect(() =>
                loadFromStart(list, {
                    afterMessageIndex: null,
                    hasMoreMessagesAfter: true,
                    messages: [{index: 0}, {index: 2}, {index: 1}],
                }),
            ).toThrow(InternalError);
        });

        test("messages must start after the cursor", () => {
            const list = PaginatedMessageList.new(8);

            expect(() =>
                loadFromStart(list, {
                    afterMessageIndex: 2,
                    hasMoreMessagesAfter: true,
                    messages: [{index: 2}, {index: 3}, {index: 4}],
                }),
            ).toThrow(InternalError);

            expect(() =>
                loadFromStart(list, {
                    afterMessageIndex: 3,
                    hasMoreMessagesAfter: true,
                    messages: [{index: 2}, {index: 3}, {index: 4}],
                }),
            ).toThrow(InternalError);

            expect(() =>
                loadFromStart(list, {
                    afterMessageIndex: 5,
                    hasMoreMessagesAfter: true,
                    messages: [{index: 2}, {index: 3}, {index: 4}],
                }),
            ).toThrow(InternalError);
        });

        test("can load normally", () => {
            let list = PaginatedMessageList.new(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [{index: 3}, {index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: false,
                messages: [{index: 6}, {index: 7}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                        {index: 6},
                        {index: 7},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load with no messages at the end", () => {
            let list = PaginatedMessageList.new(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [{index: 3}, {index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: false,
                messages: [],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load and replace existing messages", () => {
            let list = PaginatedMessageList.new<{index: number; test: number}>(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 0, test: 1},
                    {index: 1, test: 1},
                    {index: 2, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 1},
                    {index: 4, test: 1},
                    {index: 5, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 1},
                        {index: 4, test: 1},
                        {index: 5, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 2},
                    {index: 4, test: 2},
                    {index: 5, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 2},
                        {index: 4, test: 2},
                        {index: 5, test: 2},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("can load and delete existing messages at start", () => {
            let list = PaginatedMessageList.new<{index: number; test: number}>(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 0, test: 1},
                    {index: 1, test: 1},
                    {index: 2, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 1},
                    {index: 4, test: 1},
                    {index: 5, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 1},
                        {index: 4, test: 1},
                        {index: 5, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 2},
                    {index: 5, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 2},
                        {index: 5, test: 2},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("can load and delete existing messages at middle", () => {
            let list = PaginatedMessageList.new<{index: number; test: number}>(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 0, test: 1},
                    {index: 1, test: 1},
                    {index: 2, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 1},
                    {index: 4, test: 1},
                    {index: 5, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 1},
                        {index: 4, test: 1},
                        {index: 5, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 2},
                    {index: 5, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 2},
                        {index: 5, test: 2},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("can load and not delete existing messages at end", () => {
            let list = PaginatedMessageList.new<{index: number; test: number}>(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 0, test: 1},
                    {index: 1, test: 1},
                    {index: 2, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 1},
                    {index: 4, test: 1},
                    {index: 5, test: 1},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 1},
                        {index: 4, test: 1},
                        {index: 5, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 3, test: 2},
                    {index: 4, test: 2},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0, test: 1},
                        {index: 1, test: 1},
                        {index: 2, test: 1},
                        {index: 3, test: 2},
                        {index: 4, test: 2},
                        {index: 5, test: 1},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);
        });

        test("will not update may have more messages when loading with less than what's in the segment", () => {
            let list = PaginatedMessageList.new(8);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: false,
                messages: [{index: 3}, {index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [{index: 3}, {index: 4}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load normally in the middle of a list", () => {
            let list = PaginatedMessageList.new(18);

            list = loadFromStart(list, {
                afterMessageIndex: 10,
                hasMoreMessagesAfter: true,
                messages: [{index: 11}, {index: 12}, {index: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 11}, {index: 12}, {index: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 13,
                hasMoreMessagesAfter: true,
                messages: [{index: 14}, {index: 15}, {index: 16}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 11},
                        {index: 12},
                        {index: 13},
                        {index: 14},
                        {index: 15},
                        {index: 16},
                    ],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 16,
                hasMoreMessagesAfter: false,
                messages: [{index: 17}, {index: 18}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 11},
                        {index: 12},
                        {index: 13},
                        {index: 14},
                        {index: 15},
                        {index: 16},
                        {index: 17},
                        {index: 18},
                    ],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load on top of messages loaded in the middle of a list", () => {
            let list = PaginatedMessageList.new(16);

            list = loadFromStart(list, {
                afterMessageIndex: 10,
                hasMoreMessagesAfter: true,
                messages: [{index: 11}, {index: 12}, {index: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 11}, {index: 12}, {index: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 13,
                hasMoreMessagesAfter: false,
                messages: [{index: 14}, {index: 15}, {index: 16}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 11},
                        {index: 12},
                        {index: 13},
                        {index: 14},
                        {index: 15},
                        {index: 16},
                    ],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 8,
                hasMoreMessagesAfter: true,
                messages: [{index: 9}, {index: 10}, {index: 11}, {index: 12}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 9},
                        {index: 10},
                        {index: 11},
                        {index: 12},
                        {index: 13},
                        {index: 14},
                        {index: 15},
                        {index: 16},
                    ],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}, {index: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 9},
                        {index: 10},
                        {index: 11},
                        {index: 12},
                        {index: 13},
                        {index: 14},
                        {index: 15},
                        {index: 16},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("if loading a new segment with no more messages after it clears following segments", () => {
            let list = PaginatedMessageList.new(40);

            list = loadFromStart(list, {
                afterMessageIndex: 30,
                hasMoreMessagesAfter: true,
                messages: [{index: 31}, {index: 32}, {index: 33}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 31}, {index: 32}, {index: 33}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 20,
                hasMoreMessagesAfter: false,
                messages: [{index: 21}, {index: 22}, {index: 23}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 21}, {index: 22}, {index: 23}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 10,
                hasMoreMessagesAfter: true,
                messages: [{index: 11}, {index: 12}, {index: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 11}, {index: 12}, {index: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 21}, {index: 22}, {index: 23}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: false,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("if loading into an existing segment with no more messages after it clears following segments", () => {
            let list = PaginatedMessageList.new(30);

            list = loadFromStart(list, {
                afterMessageIndex: 10,
                hasMoreMessagesAfter: true,
                messages: [{index: 11}, {index: 12}, {index: 13}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 11}, {index: 12}, {index: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 20,
                hasMoreMessagesAfter: true,
                messages: [{index: 21}, {index: 22}, {index: 23}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 11}, {index: 12}, {index: 13}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 21}, {index: 22}, {index: 23}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 11,
                hasMoreMessagesAfter: false,
                messages: [{index: 12}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 11}, {index: 12}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load multiple segments", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: false,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge multiple segments when loading", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: false,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [{index: 3}, {index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                        {index: 6},
                        {index: 7},
                        {index: 8},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge three segments when loading", () => {
            let list = PaginatedMessageList.new(15);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: true,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            list = loadFromStart(list, {
                afterMessageIndex: 11,
                hasMoreMessagesAfter: false,
                messages: [{index: 12}, {index: 13}, {index: 14}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 12}, {index: 13}, {index: 14}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 1,
                hasMoreMessagesAfter: true,
                messages: [
                    {index: 2},
                    {index: 3},
                    {index: 4},
                    {index: 5},
                    {index: 6},
                    {index: 7},
                    {index: 8},
                    {index: 9},
                    {index: 10},
                    {index: 11},
                    {index: 12},
                ],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                        {index: 6},
                        {index: 7},
                        {index: 8},
                        {index: 9},
                        {index: 10},
                        {index: 11},
                        {index: 12},
                        {index: 13},
                        {index: 14},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge segment into the end of another segment when loading", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: false,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [{index: 3}, {index: 4}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}, {index: 3}, {index: 4}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge segment into the start of another segment when loading", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 5,
                hasMoreMessagesAfter: false,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 3,
                hasMoreMessagesAfter: true,
                messages: [{index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 4}, {index: 5}, {index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load from both ends simultaneously 1", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageIndex: null,
                hasMoreMessagesBefore: true,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageIndex: 2,
                hasMoreMessagesAfter: true,
                messages: [{index: 3}, {index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                        {index: 6},
                        {index: 7},
                        {index: 8},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load from both ends simultaneously 2", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: true,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageIndex: null,
                hasMoreMessagesBefore: true,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageIndex: 6,
                hasMoreMessagesBefore: true,
                messages: [{index: 3}, {index: 4}, {index: 5}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [
                        {index: 0},
                        {index: 1},
                        {index: 2},
                        {index: 3},
                        {index: 4},
                        {index: 5},
                        {index: 6},
                        {index: 7},
                        {index: 8},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load after an already loaded segment", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: null,
                hasMoreMessagesAfter: false,
                messages: [{index: 0}, {index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageIndex: null,
                hasMoreMessagesBefore: true,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 0}, {index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can load after an already loaded segment with some messages before", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageIndex: 0,
                hasMoreMessagesAfter: false,
                messages: [{index: 1}, {index: 2}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageIndex: null,
                hasMoreMessagesBefore: true,
                messages: [{index: 6}, {index: 7}, {index: 8}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{index: 1}, {index: 2}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{index: 6}, {index: 7}, {index: 8}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });
    });
}
