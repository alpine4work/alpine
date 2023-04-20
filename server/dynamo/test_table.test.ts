import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {getTestIndex, getTestTable} from "~/server/dynamo/test_table";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";

const TestTable = getTestTable();
const TestIndex = getTestIndex();

const context = createTestContext();

test("experiment", async () => {
    await runAllPromises([
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionA: 1,
            sortRangeA1: 1,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionA: 1,
            sortRangeA2: 1,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionA: 1,
            sortRangeA1: 2,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionA: 1,
            sortRangeA2: 2,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionA: 2,
            sortRangeA1: 2,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionA: 2,
            sortRangeA2: 2,
            attributeX: 1,
            attributeY: 1,
        }),
    ]);

    await runAllPromises([
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionB: 1,
            sortRangeB1: 1,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB2",
            partitionB: 1,
            sortRangeB2: 1,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionB: 1,
            sortRangeB1: 2,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB2",
            partitionB: 1,
            sortRangeB2: 2,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionB: 2,
            sortRangeB1: 2,
            attributeX: 1,
            attributeY: 1,
        }),
        TestTable.createOrReplaceItem(context, {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB2",
            partitionB: 2,
            sortRangeB2: 2,
            attributeX: 1,
            attributeY: 1,
        }),
    ]);

    console.log(
        await arrayFromAsyncIterable(
            TestIndex.query(context, {partitionKey: {attributeX: 1}, limit: "All"}),
        ),
    );
    console.log(
        await arrayFromAsyncIterable(
            TestIndex.query(context, {partitionKey: {attributeX: 1}, limit: "All"}),
        ),
    );
    console.log(
        await arrayFromAsyncIterable(
            TestIndex.query(context, {partitionKey: {attributeX: 1}, limit: "All"}),
        ),
    );
    console.log(
        await arrayFromAsyncIterable(
            TestIndex.query(context, {partitionKey: {attributeX: 1}, limit: "All"}),
        ),
    );
    console.log(
        await arrayFromAsyncIterable(
            TestIndex.query(context, {partitionKey: {attributeX: 1}, limit: "All"}),
        ),
    );
});
