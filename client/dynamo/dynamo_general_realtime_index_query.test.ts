import {
    DynamoGeneralRealtimeIndexQuery,
    DynamoGeneralRealtimeIndexQueryItem,
} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {DynamoIndexCursor, DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";

function testItemKey(string: string): DynamoItemKey {
    return string as DynamoItemKey;
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

    return items;
}

test("initializes an empty query", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("initializes a query with items from end", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("initializes a query with items from start and a next page", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);
});

test("initializes a query with items from end and a previous page", () => {
    const query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("items update after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a2")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a0")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a0")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
    ]);
});

test("items update after receiving a realtime event out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a2")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a0")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a0")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
    ]);
});

test("items move after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("Zy")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a0"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
            },
        },
    ]);
});

test("items move after receiving a realtime event out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 4,
                model: "item0-v4",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item0"),
                version: 4,
                model: "item0-v4",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 3,
                model: "item0-v3",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a0")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item0"),
                version: 4,
                model: "item0-v4",
            },
        },
    ]);
});

test("items move out of bounds after receiving a realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: "Zz",
        endCursorBound: "a3",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("Zy")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
    ]);
});

test("items move out of bounds and stays out of bounds after receiving an out-of-order realtime event", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: "Zz",
        endCursorBound: "a3",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 2,
                model: "item2-v2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("Zy")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 2,
                model: "item0-v2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a0")]]),
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
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a2")]]),
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
            },
        },
    ]);
});

test("item created within the query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a1V")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1V"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("item created then moved out of bounds within the query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: "a3",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a1V")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1V"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 1,
                model: "item4",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("item created then moved out of bounds within the query received out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: "a3",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 1,
                model: "item4",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a1V")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("item moving in and out of bounds", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: "a3",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 1,
                model: "item1-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 2,
                model: "item1-v2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a1")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 2,
                model: "item1-v2",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 3,
                model: "item1-v3",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("item moving in and out of bounds received out-of-order", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: "a3",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 1,
                model: "item1-v1",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 3,
                model: "item1-v3",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a4")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.handleEventTransaction(new Date(), [
        {
            type: "PutItem",
            item: {
                key: testItemKey("item1"),
                version: 2,
                model: "item1-v2",
            },
            cursorByIndexName: new Map([["Test", testIndexCursor("a1")]]),
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("can load more at the end of a query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item6"),
                version: 0,
                model: "item6",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item7"),
                version: 0,
                model: "item7",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item8"),
                version: 0,
                model: "item8",
            },
        },
    ]);
});

test("can load more at the start of a query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item7"),
                version: 0,
                model: "item7",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item8"),
                version: 0,
                model: "item8",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a6"),
            item: {
                key: testItemKey("item0"),
                version: 0,
                model: "item0",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a7"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a8"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("can load more at the end of a query that overlaps a bit with the previous query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 1,
                model: "item2-v1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item3"),
                version: 0,
                model: "item3",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        },
    ]);
});

test("can load more at the end in a way that doesn't overlap with the last query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
        {
            type: "LoadingIndicator",
        },
    ]);
});

test("can load more at the start of a query that overlaps a bit with the previous query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a1"),
            item: {
                key: testItemKey("item4"),
                version: 0,
                model: "item4",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a2"),
            item: {
                key: testItemKey("item5"),
                version: 0,
                model: "item5",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a3"),
            item: {
                key: testItemKey("item0"),
                version: 1,
                model: "item0-v1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});

test("can load more at the start in a way that doesn't overlap with the last query", () => {
    let query = DynamoGeneralRealtimeIndexQuery.new({
        readTime: new Date(),
        indexName: "Test",
        startCursorBound: null,
        endCursorBound: null,
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);

    query = query.loadMore({
        readTime: new Date(),
        indexName: "Test",
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
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a4"),
            item: {
                key: testItemKey("item1"),
                version: 0,
                model: "item1",
            },
        },
        {
            type: "Loaded",
            cursor: testIndexCursor("a5"),
            item: {
                key: testItemKey("item2"),
                version: 0,
                model: "item2",
            },
        },
    ]);
});
