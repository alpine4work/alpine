import {
    DynamoGeneralRealtimeIndexQuery,
    DynamoGeneralRealtimeIndexQueryItem,
} from "~/client/web/dynamo/dynamo_general_realtime_index_query.js";
import {
    DynamoIndexCursor,
    DynamoIndexPartitionKey,
    DynamoItemKey,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {generateServerSynchronizationCheckpointForTest} from "~/shared/web_socket/server_synchronization_checkpoint.js";

function testItemKey(string: string): DynamoItemKey {
    return string as DynamoItemKey;
}

function testIndexPartitionKey(string: string): DynamoIndexPartitionKey {
    return string as DynamoIndexPartitionKey;
}

function testIndexCursor(string: string): DynamoIndexCursor {
    return string as DynamoIndexCursor;
}

function testItems<Model>(
    query: DynamoGeneralRealtimeIndexQuery<Model>,
): Array<DynamoGeneralRealtimeIndexQueryItem<Model>> {
    const items: Array<DynamoGeneralRealtimeIndexQueryItem<Model>> = [];

    for (let index = 0; index < query.getItemCount(); index++) {
        items.push(query.getItem(index));
    }

    expect(query.getLoadedItemByCursor().values).toEqual(
        filterMapArray(items, item => (item.type === "Loaded" ? item.item : undefined)),
    );

    return items;
}

test("initializes an empty query", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [],
    });

    expect(testItems(query)).toEqual([]);
});

test("initializes a query with items from start", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("initializes a query with items from end", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeCursor: null,
            hasPreviousPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("initializes a query with items from start and a next page", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);
});

test("initializes a query with items from end and a previous page", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeCursor: null,
            hasPreviousPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "LoadingIndicator",
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("items update after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);
});

test("items update after receiving a realtime event out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);
});

test("items move after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("Zy")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("Zy"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("Zy"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
                extra: null,
            },
        },
    ]);
});

test("items move after receiving a realtime event out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 4,
                model: "item0-v4",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item0"),
                version: 4,
                model: "item0-v4",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 3,
                model: "item0-v3",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item0"),
                version: 4,
                model: "item0-v4",
                extra: null,
            },
        },
    ]);
});

test("items move out of bounds after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: "Zz",
        endCursorBound: "a3",
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("Zy")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("items move out of bounds and stays out of bounds after receiving an out-of-order realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: "Zz",
        endCursorBound: "a3",
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("Zy")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item created within the query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a1V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1V"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item created then moved out of bounds within the query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: "a3",
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a1V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1V"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 1,
                model: "item4",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item created then moved out of bounds within the query received out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: "a3",
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 1,
                model: "item4",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a1V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item moving in and out of bounds", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: "a3",
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 1,
                model: "item1-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 2,
                model: "item1-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a1")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 2,
                model: "item1-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 3,
                model: "item1-v3",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item moving in and out of bounds received out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: "a3",
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 1,
                model: "item1-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 3,
                model: "item1-v3",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a4")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 2,
                model: "item1-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a1")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("can load more at the end of a query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromStart",
            afterCursor: testIndexCursor("a2"),
            hasNextPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a3"),
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
            {
                cursor: testIndexCursor("a4"),
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            {
                cursor: testIndexCursor("a5"),
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromStart",
            afterCursor: testIndexCursor("a5"),
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a6"),
                key: testItemKey("item6"),
                version: 0,
                model: "item6",
            },
            {
                cursor: testIndexCursor("a7"),
                key: testItemKey("item7"),
                version: 0,
                model: "item7",
            },
            {
                cursor: testIndexCursor("a8"),
                key: testItemKey("item8"),
                version: 0,
                model: "item8",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item6"),
                version: 0,
                model: "item6",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item7"),
                version: 0,
                model: "item7",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item8"),
                version: 0,
                model: "item8",
                extra: null,
            },
        },
    ]);
});

test("can load more at the start of a query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeCursor: null,
            hasPreviousPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a6"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a7"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a8"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "LoadingIndicator",
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            beforeCursor: testIndexCursor("a6"),
            hasPreviousPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a3"),
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
            {
                cursor: testIndexCursor("a4"),
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            {
                cursor: testIndexCursor("a5"),
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "LoadingIndicator",
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            beforeCursor: testIndexCursor("a3"),
            hasPreviousPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item6"),
                version: 0,
                model: "item6",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item7"),
                version: 0,
                model: "item7",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item8"),
                version: 0,
                model: "item8",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item6"),
                version: 0,
                model: "item6",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item7"),
                version: 0,
                model: "item7",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item8"),
                version: 0,
                model: "item8",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("can load more at the end of a query that overlaps a bit with the previous query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromStart",
            afterCursor: testIndexCursor("a1"),
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            {
                cursor: testIndexCursor("a3"),
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
            {
                cursor: testIndexCursor("a4"),
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            {
                cursor: testIndexCursor("a5"),
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
    ]);
});

test("can load more at the end in a way that doesn\u2019t overlap with the last query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromStart",
            afterCursor: testIndexCursor("a3"),
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a4"),
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            {
                cursor: testIndexCursor("a5"),
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);
});

test("can load more at the start of a query that overlaps a bit with the previous query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeCursor: null,
            hasPreviousPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a3"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a4"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a5"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "LoadingIndicator",
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            beforeCursor: testIndexCursor("a4"),
            hasPreviousPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
            {
                cursor: testIndexCursor("a3"),
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("can load more at the start in a way that doesn\u2019t overlap with the last query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeCursor: null,
            hasPreviousPage: true,
        },
        items: [
            {
                cursor: testIndexCursor("a3"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a4"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a5"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "LoadingIndicator",
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            beforeCursor: testIndexCursor("a2"),
            hasPreviousPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "LoadingIndicator",
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item is removed if partition key changes after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p1"), cursor: testIndexCursor("a0V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p2"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is removed if partition key changes after receiving an out-of-order realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p1"), cursor: testIndexCursor("a0V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p2"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving a delete realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving an out-of-order delete realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving a delete realtime event after being created by a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving an out-of-order delete realtime event after being created by a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a2")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("can undelete deleted item after receiving a delete realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a0V"),
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("can delete an undeleted deleted item after receiving a delete realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a0V"),
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 3,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("can delete an undeleted deleted item after receiving an out-of-order delete realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        indexName: "Test",
        partitionKey: testIndexPartitionKey("p0"),
        startCursorBound: null,
        endCursorBound: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterCursor: null,
            hasNextPage: false,
        },
        items: [
            {
                cursor: testIndexCursor("a0"),
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
            {
                cursor: testIndexCursor("a1"),
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
            {
                cursor: testIndexCursor("a2"),
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("item2"),
                version: 3,
            },
            indexes: new Set(["Test"]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEventTransaction([
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map([
                [
                    "Test",
                    {partitionKey: testIndexPartitionKey("p0"), cursor: testIndexCursor("a0V")},
                ],
            ]),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});
