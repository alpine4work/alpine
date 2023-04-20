import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {Schema} from "~/shared/schema/schema";

const TestTable = DynamoTableSchema.new({
    name: "IndexSortOrderTest",
    partitions: [
        {
            name: "PartitionA",
            partitionKeyAttributes: {
                partitionA: DynamoKeyAttributeSchema.integer,
            },
            sortRanges: [
                {
                    name: "SortRangeA1",
                    sortKeyAttributes: {
                        sortRangeA1: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        attributeX: Schema.integer,
                        attributeY: Schema.integer,
                    }),
                },
                {
                    name: "SortRangeA2",
                    sortKeyAttributes: {
                        sortRangeA2: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        attributeX: Schema.integer,
                        attributeY: Schema.integer,
                    }),
                },
            ],
        },
        {
            name: "PartitionB",
            partitionKeyAttributes: {
                partitionB: DynamoKeyAttributeSchema.integer,
            },
            sortRanges: [
                {
                    name: "SortRangeB1",
                    sortKeyAttributes: {
                        sortRangeB1: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        attributeX: Schema.integer,
                        attributeY: Schema.integer,
                    }),
                },
                {
                    name: "SortRangeB2",
                    sortKeyAttributes: {
                        sortRangeB2: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        attributeX: Schema.integer,
                        attributeY: Schema.integer,
                    }),
                },
            ],
        },
    ],
});

const TestIndex = TestTable.addIndex({
    name: "IndexSortOrderTestIndex",
    itemTypes: [
        {partitionType: "PartitionA", sortRangeType: "SortRangeA1"},
        {partitionType: "PartitionA", sortRangeType: "SortRangeA2"},
        {partitionType: "PartitionB", sortRangeType: "SortRangeB1"},
        {partitionType: "PartitionB", sortRangeType: "SortRangeB2"},
    ],
    partitionKeyAttributes: {
        attributeX: DynamoKeyAttributeSchema.integer,
    },
    sortKeyAttributes: {
        attributeY: DynamoKeyAttributeSchema.integer,
    },
});

export function getTestTable() {
    return TestTable;
}

export function getTestIndex() {
    return TestIndex;
}
