import {
    PaginatedMessageList,
    maxMessageId,
    minMessageId,
} from "~/client/messaging/paginated_message_list";
import {InternalError} from "~/shared/error/error";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";

test("can load into an empty list", () => {
    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, estimatedMessageCount: 100}])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 20},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 70},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, estimatedMessageCount: 100}])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 70},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, estimatedMessageCount: 100}])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 20},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: false, estimatedMessageCount: 100}])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);
});

test("can load into an empty list with no estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);
});

test("can load in the middle of an unloaded segment when there is one loaded segment at the start", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 1}]},
            {isLoaded: false, estimatedMessageCount: 100},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{id: 1}]},
        {isLoaded: false, estimatedMessageCount: 19},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 71},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 1}]},
            {isLoaded: false, estimatedMessageCount: 100},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 71},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 1}]},
            {isLoaded: false, estimatedMessageCount: 100},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{id: 1}]},
        {isLoaded: false, estimatedMessageCount: 19},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 1}]},
            {isLoaded: false, estimatedMessageCount: 100},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);
});

test("can load in the middle of an unloaded segment when there is one loaded segment at the end", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 100},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 20},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 70},
        {isLoaded: true, messages: [{id: 101}]},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 100},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 70},
        {isLoaded: true, messages: [{id: 101}]},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 100},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 20},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 100},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: false,
                mayHaveMoreMessagesAfter: false,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
    ]);
});

test("can load in the middle of an unloaded segment at the beginning with deleted messages", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 100},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 21}, {id: 23}, {id: 25}, {id: 27}, {id: 29}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 21},
        {
            isLoaded: true,
            messages: [{id: 21}, {id: 23}, {id: 25}, {id: 27}, {id: 29}],
        },
        {isLoaded: false, estimatedMessageCount: 74},
        {isLoaded: true, messages: [{id: 101}]},
    ]);
});

test("can load in the middle of an unbalanced unloaded segment", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 1}]},
            {isLoaded: false, estimatedMessageCount: 70},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 21},
                    {id: 22},
                    {id: 23},
                    {id: 24},
                    {id: 25},
                    {id: 26},
                    {id: 27},
                    {id: 28},
                    {id: 29},
                    {id: 30},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{id: 1}]},
        {isLoaded: false, estimatedMessageCount: 13},
        {
            isLoaded: true,
            messages: [
                {id: 21},
                {id: 22},
                {id: 23},
                {id: 24},
                {id: 25},
                {id: 26},
                {id: 27},
                {id: 28},
                {id: 29},
                {id: 30},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 47},
        {isLoaded: true, messages: [{id: 101}]},
    ]);
});

test("can load in the middle of an unbalanced unloaded segment with deleted messages", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 1}]},
            {isLoaded: false, estimatedMessageCount: 70},
            {isLoaded: true, messages: [{id: 101}]},
        ])
            .loadMessages({
                afterMessageId: 20,
                beforeMessageId: 31,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 21}, {id: 23}, {id: 25}, {id: 27}, {id: 29}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{id: 1}]},
        {isLoaded: false, estimatedMessageCount: 14},
        {
            isLoaded: true,
            messages: [{id: 21}, {id: 23}, {id: 25}, {id: 27}, {id: 29}],
        },
        {isLoaded: false, estimatedMessageCount: 51},
        {isLoaded: true, messages: [{id: 101}]},
    ]);
});

test("when merging will decrease next unloaded segment estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 9,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}]},
        {isLoaded: false, estimatedMessageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 9,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 10},
        {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}]},
        {isLoaded: false, estimatedMessageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
        ])
            .loadMessages({
                afterMessageId: 9,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 10},
        {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}]},
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]}])
            .loadMessages({
                afterMessageId: 9,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}]},
        {isLoaded: false, estimatedMessageCount: 1},
    ]);
});

test("when merging will decrease last unloaded segment estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 7},
        {isLoaded: true, messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}]},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 7},
        {isLoaded: true, messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}]},
        {isLoaded: false, estimatedMessageCount: 10},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {isLoaded: true, messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}]},
        {isLoaded: false, estimatedMessageCount: 10},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]}])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 9,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {isLoaded: true, messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}]},
    ]);
});

test("when merging will decrease next and last unloaded segment estimated message count", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 5},
                    {id: 6},
                    {id: 7},
                    {id: 8},
                    {id: 9},
                    {id: 10},
                    {id: 11},
                    {id: 12},
                    {id: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 7},
        {
            isLoaded: true,
            messages: [
                {id: 5},
                {id: 6},
                {id: 7},
                {id: 8},
                {id: 9},
                {id: 10},
                {id: 11},
                {id: 12},
                {id: 13},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 5},
                    {id: 6},
                    {id: 7},
                    {id: 8},
                    {id: 9},
                    {id: 10},
                    {id: 11},
                    {id: 12},
                    {id: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [
                {id: 5},
                {id: 6},
                {id: 7},
                {id: 8},
                {id: 9},
                {id: 10},
                {id: 11},
                {id: 12},
                {id: 13},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 5},
                    {id: 6},
                    {id: 7},
                    {id: 8},
                    {id: 9},
                    {id: 10},
                    {id: 11},
                    {id: 12},
                    {id: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 7},
        {
            isLoaded: true,
            messages: [
                {id: 5},
                {id: 6},
                {id: 7},
                {id: 8},
                {id: 9},
                {id: 10},
                {id: 11},
                {id: 12},
                {id: 13},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]}])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [
                    {id: 5},
                    {id: 6},
                    {id: 7},
                    {id: 8},
                    {id: 9},
                    {id: 10},
                    {id: 11},
                    {id: 12},
                    {id: 13},
                ],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [
                {id: 5},
                {id: 6},
                {id: 7},
                {id: 8},
                {id: 9},
                {id: 10},
                {id: 11},
                {id: 12},
                {id: 13},
            ],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);
});

test("when merging will decrease next and last unloaded segment estimated message count in an unbalanced way", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 6,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 9},
        {
            isLoaded: true,
            messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
        },
        {isLoaded: false, estimatedMessageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]}])
            .loadMessages({
                afterMessageId: 6,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 6,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
        },
        {isLoaded: false, estimatedMessageCount: 7},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
        ])
            .loadMessages({
                afterMessageId: 6,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 9},
        {
            isLoaded: true,
            messages: [{id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}, {id: 12}, {id: 13}],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 7},
        {
            isLoaded: true,
            messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
        },
        {isLoaded: false, estimatedMessageCount: 9},
    ]);

    expect(
        PaginatedMessageList.newForTest([{isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]}])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 1},
        {
            isLoaded: true,
            messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
        },
        {isLoaded: false, estimatedMessageCount: 9},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 12,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 7},
        {
            isLoaded: true,
            messages: [{id: 5}, {id: 6}, {id: 7}, {id: 8}, {id: 9}, {id: 10}, {id: 11}],
        },
        {isLoaded: false, estimatedMessageCount: 1},
    ]);
});

test("when merging will decrease estimated message count only by new messages", () => {
    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
            {isLoaded: false, estimatedMessageCount: 10},
        ])
            .loadMessages({
                afterMessageId: 8,
                beforeMessageId: 14,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 10}, {id: 12}, {id: 13}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {
            isLoaded: true,
            messages: [{id: 8}, {id: 10}, {id: 12}, {id: 13}],
        },
        {isLoaded: false, estimatedMessageCount: 8},
    ]);

    expect(
        PaginatedMessageList.newForTest([
            {isLoaded: false, estimatedMessageCount: 10},
            {isLoaded: true, messages: [{id: 8}, {id: 9}, {id: 10}]},
        ])
            .loadMessages({
                afterMessageId: 4,
                beforeMessageId: 10,
                mayHaveMoreMessagesBefore: true,
                mayHaveMoreMessagesAfter: true,
                messages: [{id: 5}, {id: 6}, {id: 8}],
            })
            .getSegmentsForTest(),
    ).toEqual([
        {isLoaded: false, estimatedMessageCount: 8},
        {
            isLoaded: true,
            messages: [{id: 5}, {id: 6}, {id: 8}, {id: 10}],
        },
    ]);
});

// NOTE(calebmer, 2023-01-24): This test harness was written when
// `PaginatedMessageList` had a different API. Keeping these tests because they
// cover the file well but the test harness is a little weird because of
// that change.
type TestSuite = {
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
    ) => ReadonlyArray<{
        messages: ReadonlyArray<Message>;
        mayHaveMoreMessagesBefore: boolean;
        mayHaveMoreMessagesAfter: boolean;
    }>;
};

const loadFromStartTestSuite: TestSuite = {
    name: "loadFromStart",
    loadFromStart: (list, options) => {
        const afterMessageId = options.afterMessageId ?? minMessageId - 1;
        return list.loadMessages({
            afterMessageId,
            beforeMessageId:
                (options.messages[options.messages.length - 1]?.id ?? afterMessageId) + 1,
            mayHaveMoreMessagesBefore: options.afterMessageId !== null,
            mayHaveMoreMessagesAfter: options.hasMoreMessagesAfter,
            messages: options.messages,
        });
    },
    loadFromEnd: (list, options) => {
        const beforeMessageId = options.beforeMessageId ?? maxMessageId + 1;
        return list.loadMessages({
            afterMessageId: (options.messages[0]?.id ?? beforeMessageId) - 1,
            beforeMessageId,
            mayHaveMoreMessagesBefore: options.hasMoreMessagesBefore,
            mayHaveMoreMessagesAfter: options.beforeMessageId !== null,
            messages: options.messages,
        });
    },
    getSegments: list => {
        // Every time we call `getSegments()` also run a test on `getMessage()` and
        // `getIndexByMessageId()` to make sure they behave correctly.
        for (const {index, message} of list.iterateMessagesForTest()) {
            expect(list.getMessage(index)).toEqual({isLoaded: true, message});
            expect(list.getIndexByMessageId(message.id)).toEqual(index);
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
                beforeMessageId:
                    options.afterMessageId !== null ? 1000 - options.afterMessageId : null,
                hasMoreMessagesBefore: options.hasMoreMessagesAfter,
                messages: options.messages
                    .map(message => ({...message, id: 1000 - message.id}))
                    .reverse(),
            }),
        loadFromEnd: (list, options) =>
            loadFromStartTestSuite.loadFromStart(list, {
                afterMessageId:
                    options.beforeMessageId !== null ? 1000 - options.beforeMessageId : null,
                hasMoreMessagesAfter: options.hasMoreMessagesBefore,
                messages: options.messages
                    .map(message => ({...message, id: 1000 - message.id}))
                    .reverse(),
            }),
        getSegments: list =>
            loadFromStartTestSuite
                .getSegments(list)
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
            const list = PaginatedMessageList.new(0);

            expect(getSegments(list)).toEqual([]);
        });

        test("messages must be in ascending id order", () => {
            const list = PaginatedMessageList.new(8);

            expect(() =>
                loadFromStart(list, {
                    afterMessageId: null,
                    hasMoreMessagesAfter: true,
                    messages: [{id: 1}, {id: 3}, {id: 2}],
                }),
            ).toThrow(InternalError);
        });

        test("messages must start after the cursor", () => {
            const list = PaginatedMessageList.new(8);

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
            let list = PaginatedMessageList.new(8);

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
            let list = PaginatedMessageList.new(8);

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
            let list = PaginatedMessageList.new<{id: number; test: number}>(8);

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
            let list = PaginatedMessageList.new<{id: number; test: number}>(8);

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
            let list = PaginatedMessageList.new<{id: number; test: number}>(8);

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
            let list = PaginatedMessageList.new<{id: number; test: number}>(8);

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
            let list = PaginatedMessageList.new(8);

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
            let list = PaginatedMessageList.new(18);

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
            let list = PaginatedMessageList.new(16);

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
            let list = PaginatedMessageList.new(40);

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
            let list = PaginatedMessageList.new(30);

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
            let list = PaginatedMessageList.new(9);

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
            let list = PaginatedMessageList.new(9);

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

        test("can merge three segments when loading", () => {
            let list = PaginatedMessageList.new(15);

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
                hasMoreMessagesAfter: true,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            list = loadFromStart(list, {
                afterMessageId: 12,
                hasMoreMessagesAfter: false,
                messages: [{id: 13}, {id: 14}, {id: 15}],
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
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 13}, {id: 14}, {id: 15}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromStart(list, {
                afterMessageId: 2,
                hasMoreMessagesAfter: true,
                messages: [
                    {id: 3},
                    {id: 4},
                    {id: 5},
                    {id: 6},
                    {id: 7},
                    {id: 8},
                    {id: 9},
                    {id: 10},
                    {id: 11},
                    {id: 12},
                    {id: 13},
                ],
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
                        {id: 10},
                        {id: 11},
                        {id: 12},
                        {id: 13},
                        {id: 14},
                        {id: 15},
                    ],
                    mayHaveMoreMessagesBefore: false,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });

        test("can merge segment into the end of another segment when loading", () => {
            let list = PaginatedMessageList.new(9);

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
            let list = PaginatedMessageList.new(9);

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
            let list = PaginatedMessageList.new(9);

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
            let list = PaginatedMessageList.new(9);

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

        test("can load after an already loaded segment", () => {
            let list = PaginatedMessageList.new(9);

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
        });

        test("can load after an already loaded segment with some messages before", () => {
            let list = PaginatedMessageList.new(9);

            list = loadFromStart(list, {
                afterMessageId: 1,
                hasMoreMessagesAfter: false,
                messages: [{id: 2}, {id: 3}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);

            list = loadFromEnd(list, {
                beforeMessageId: null,
                hasMoreMessagesBefore: true,
                messages: [{id: 7}, {id: 8}, {id: 9}],
            });

            expect(getSegments(list)).toEqual([
                {
                    messages: [{id: 2}, {id: 3}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: true,
                },
                {
                    messages: [{id: 7}, {id: 8}, {id: 9}],
                    mayHaveMoreMessagesBefore: true,
                    mayHaveMoreMessagesAfter: false,
                },
            ]);
        });
    });
}
