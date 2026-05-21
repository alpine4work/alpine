import {RynamoQuery, RynamoQueryItem} from "~/client/web/dynamo/rynamo_query.js";
import {DynamoItemKey, DynamoItemPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {generateServerSynchronizationCheckpointForTest} from "~/shared/web_socket/server_synchronization_checkpoint.js";

function testItemKey(string: string): DynamoItemKey {
    return encodeBase64(
        new TextEncoder().encode(string),
        "Rfc4648UrlWithOrderPreservation",
    ) as DynamoItemKey;
}

function testPartitionKey(string: string): DynamoItemPartitionKey {
    return encodeBase64(
        new TextEncoder().encode(string),
        "Rfc4648UrlWithOrderPreservation",
    ) as DynamoItemPartitionKey;
}

function testItems<Model>(query: RynamoQuery<Model>): Array<RynamoQueryItem<Model>> {
    const items: Array<RynamoQueryItem<Model>> = [];

    for (let index = 0; index < query.getItemCount(); index++) {
        items.push(query.getItem(index));
    }

    expect(query.getLoadedItemByKey().values).toEqual(
        filterMapArray(items, item => (item.type === "Loaded" ? item.item : undefined)),
    );

    return items;
}

test("initializes an empty query", () => {
    const query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [],
    });

    expect(testItems(query)).toEqual([]);
});

test("initializes a query with items from start", () => {
    const query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("initializes a query with items from end", () => {
    const query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: null,
            hasPreviousPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("initializes a query with items from start and a next page", () => {
    const query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
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
    const query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: null,
            hasPreviousPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
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
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("items update after receiving a realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 1,
                model: "item0-v1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 2,
                model: "item0-v2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);
});

test("items update after receiving a realtime event out-of-order", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 2,
                model: "item0-v2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 2,
                model: "item0-v2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
    ]);
});

test("adds new items after receiving a realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
            {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
    ]);
});

test("adds and deletes items out of bounds after receiving a realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: testItemKey("p0-Zz"),
        endItemKey: testItemKey("p0-a3"),
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-Zy"),
                version: 0,
                model: "item3",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-Zy"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item created within the query", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a1V"),
                version: 0,
                model: "item4",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1V"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("can load more at the end of a query", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
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
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: testItemKey("p0-a2"),
            hasNextPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
            },
            {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
            },
            {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
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
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: testItemKey("p0-a5"),
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a6"),
                version: 0,
                model: "item6",
            },
            {
                key: testItemKey("p0-a7"),
                version: 0,
                model: "item7",
            },
            {
                key: testItemKey("p0-a8"),
                version: 0,
                model: "item8",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a6"),
                version: 0,
                model: "item6",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a7"),
                version: 0,
                model: "item7",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a8"),
                version: 0,
                model: "item8",
                extra: null,
            },
        },
    ]);
});

test("can load more at the start of a query", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: null,
            hasPreviousPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a6"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a7"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a8"),
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
            item: {
                key: testItemKey("p0-a6"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a7"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a8"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: testItemKey("p0-a6"),
            hasPreviousPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
            },
            {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
            },
            {
                key: testItemKey("p0-a5"),
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
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a6"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a7"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a8"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: testItemKey("p0-a3"),
            hasPreviousPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item6",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item7",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item8",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item6",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item7",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item8",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a6"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a7"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a8"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("can load more at the end of a query that overlaps a bit with the previous query", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
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
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: testItemKey("p0-a1"),
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
            },
            {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
            },
            {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
            },
            {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
    ]);
});

test("can load more at the end in a way that doesn\u2019t overlap with the last query", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
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
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromStart",
            afterItemKey: testItemKey("p0-a3"),
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item4",
            },
            {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item5",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
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
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: null,
            hasPreviousPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a5"),
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
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: testItemKey("p0-a4"),
            hasPreviousPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item3",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item4",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item5",
            },
            {
                key: testItemKey("p0-a3"),
                version: 1,
                model: "item0-v1",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item3",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item4",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item5",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a3"),
                version: 1,
                model: "item0-v1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("can load more at the start in a way that doesn\u2019t overlap with the last query", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: null,
            hasPreviousPage: true,
        },
        items: [
            {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a5"),
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
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.loadMore({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        pageInfo: {
            type: "FromEnd",
            beforeItemKey: testItemKey("a2"),
            hasPreviousPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item3",
            },
            {
                key: testItemKey("p0-a1"),
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
            item: {
                key: testItemKey("p0-a3"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a4"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a5"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("ignores items with a different partition key in realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p1-a3"),
                version: 0,
                model: "item3",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p1-a3"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving a delete realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving an out-of-order delete realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 2,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 2,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a0"),
                version: 1,
                model: "item0-v1",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
                model: "item2-v1",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving a delete realtime event after being created by a realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("item is deleted after receiving an out-of-order delete realtime event after being created by a realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("can undelete deleted item after receiving a delete realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 2,
                model: "item2-v2",
                extra: null,
            },
        },
    ]);
});

test("can delete an undeleted deleted item after receiving a delete realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 2,
                model: "item2-v2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 3,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});

test("can delete an undeleted deleted item after receiving an out-of-order delete realtime event", () => {
    let query = RynamoQuery.new({
        partitionKey: testPartitionKey("p0"),
        startItemKey: null,
        endItemKey: null,
        checkpoint: generateServerSynchronizationCheckpointForTest(),
        pageInfo: {
            type: "FromStart",
            afterItemKey: null,
            hasNextPage: false,
        },
        items: [
            {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
            },
            {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
            },
            {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
            },
        ],
    });

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a2"),
                version: 0,
                model: "item2",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 1,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "DeleteItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 3,
            },
            indexes: new Set(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);

    query = query.handleEvents([
        {
            type: "PutItem",
            item: {
                key: testItemKey("p0-a2"),
                version: 2,
                model: "item2-v2",
            },
            indexes: new Map(),
        },
    ]);

    expect(testItems(query)).toEqual([
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a0"),
                version: 0,
                model: "item0",
                extra: null,
            },
        },
        {
            type: "Loaded",
            item: {
                key: testItemKey("p0-a1"),
                version: 0,
                model: "item1",
                extra: null,
            },
        },
    ]);
});
