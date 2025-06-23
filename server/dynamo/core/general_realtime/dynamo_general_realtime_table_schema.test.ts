import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {finishInitializingDynamoTableSchemas} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const context = createTestContext();

test("can delete and undelete items", async () => {
    const space = await TestSpace.create(context);

    const TestModelSchema = Schema.object({
        type: Schema.string,
        partitionKey: Schema.integer,
        sortKey: Schema.integer,
        attribute: Schema.integer,
    });

    let eventTransactions: Array<
        ReadonlyArray<DynamoGeneralRealtimeEvent<SchemaType<typeof TestModelSchema>>>
    > = [];

    const takeEventTransactions = () => {
        const currentEventTransactions = eventTransactions;
        eventTransactions = [];
        return currentEventTransactions;
    };

    const TestTable = DynamoGeneralRealtimeTableSchema.new({
        withoutCompatibilityErrorsForTest: true,
        name: `Test_${generateId()}`,
        features: {
            deleteItem: {PartitionA: {SortRangeA2: true}},
        },
        partitions: [
            {
                name: "PartitionA",
                partitionKeyAttributes: {
                    partitionAKey: DynamoKeyAttributeSchema.integer,
                },
                sortRanges: [
                    {
                        name: "SortRangeA1",
                        sortKeyAttributes: {
                            sortA1Key: DynamoKeyAttributeSchema.integer,
                        },
                        attributes: Schema.object({
                            attribute: Schema.integer,
                        }),
                    },
                    {
                        name: "SortRangeA2",
                        sortKeyAttributes: {
                            sortA2Key: DynamoKeyAttributeSchema.integer,
                        },
                        attributes: Schema.object({
                            attribute: Schema.integer,
                        }),
                    },
                ],
            },
            {
                name: "PartitionB",
                partitionKeyAttributes: {
                    partitionBKey: DynamoKeyAttributeSchema.integer,
                },
                sortRanges: [
                    {
                        name: "SortRangeB1",
                        sortKeyAttributes: {
                            sortB1Key: DynamoKeyAttributeSchema.integer,
                        },
                        attributes: Schema.object({
                            attribute: Schema.integer,
                        }),
                    },
                ],
            },
        ],
        modelSchema: TestModelSchema,
        models: {
            PartitionA: {
                SortRangeA1: {
                    build: async (context, item) => ({
                        type: "ItemA1",
                        partitionKey: item.partitionAKey,
                        sortKey: item.sortA1Key,
                        attribute: item.attribute,
                    }),
                },
                SortRangeA2: {
                    build: async (context, item) => ({
                        type: "ItemA2",
                        partitionKey: item.partitionAKey,
                        sortKey: item.sortA2Key,
                        attribute: item.attribute,
                    }),
                },
            },
            PartitionB: {
                SortRangeB1: {
                    build: async (context, item) => ({
                        type: "ItemB1",
                        partitionKey: item.partitionBKey,
                        sortKey: item.sortB1Key,
                        attribute: item.attribute,
                    }),
                },
            },
        },
        broadcastEventTransaction: async (context, readTime, eventTransaction) => {
            eventTransactions.push(eventTransaction.map(({event}) => event));
        },
    });

    finishInitializingDynamoTableSchemas();

    const {getCount: getPutItemCount} =
        dynamoClientExecuteActionTestCounter.recordForTest("PutItem");

    const {getCount: getTransactWriteItemsCount} =
        dynamoClientExecuteActionTestCounter.recordForTest("TransactWriteItems");

    expect(getPutItemCount()).toEqual(0);
    expect(getTransactWriteItemsCount()).toEqual(0);

    expect(takeEventTransactions()).toEqual([]);

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual(null);

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(0);
        expect(getTransactWriteItemsCount()).toEqual(0);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await TestTable.createItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(1);
        expect(getTransactWriteItemsCount()).toEqual(0);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------08F3--7---------1",
                        version: 0,
                        model: {
                            type: "ItemA1",
                            partitionKey: 1,
                            sortKey: 2,
                            attribute: 3,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await TestTable.createItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 6,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(1);
        expect(getTransactWriteItemsCount()).toEqual(1);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 0,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 6,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await TestTable.createItem(space.systemAction(), {
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(2);
        expect(getTransactWriteItemsCount()).toEqual(1);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-N---------68F3--7---------7",
                        version: 0,
                        model: {
                            type: "ItemB1",
                            partitionKey: 7,
                            sortKey: 8,
                            attribute: 9,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await TestTable.createItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(2);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 0,
                        model: {
                            type: "ItemA2",
                            partitionKey: 10,
                            sortKey: 11,
                            attribute: 12,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);
    }

    {
        await TestTable.directlyUpdateItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 13,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(3);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 1,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 13,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 14,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(4);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.directlyUpdateItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 2,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 14,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 2,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
                attribute: 3,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
                attribute: 9,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(3);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 1,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 1,
                sortA2Key: 2,
                attribute: 3,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(4);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 6,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(5);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 13,
                updateLockVersion: 1,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(6);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 2,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(7);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 3,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 14,
                updateLockVersion: 2,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(8);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toEqual({updateLockVersion: 3});

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toEqual({updateLockVersion: 1});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual(null);

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(8);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 0},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                    attribute: 15,
                },
            ),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(8);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 0},
                {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                    attribute: 16,
                },
            ),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(8);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: undefined},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 17,
                },
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(9);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 1},
            {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 18,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(10);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 2,
                        model: {
                            type: "ItemA2",
                            partitionKey: 10,
                            sortKey: 11,
                            attribute: 18,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 2},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 19,
                },
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(11);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 3},
            {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 20,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(12);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 4,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 20,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 3},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 21,
                },
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(13);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 4},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 21,
                },
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 20,
            updateLockVersion: 4,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 18,
            updateLockVersion: 2,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await TestTable.directlyUpdateItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 4,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(6);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 5,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 22,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 23,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(7);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 24,
                updateLockVersion: 1,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.directlyUpdateItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 2,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 3,
                        model: {
                            type: "ItemA2",
                            partitionKey: 10,
                            sortKey: 11,
                            attribute: 25,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 5,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 5,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 6,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toEqual({updateLockVersion: 6});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.createItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 23,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(16);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            TestTable.createItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 23,
                updateLockVersion: 6,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(17);

        expect(takeEventTransactions()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 6},
            {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 24,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(18);

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 7,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 24,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 24,
            updateLockVersion: 7,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(18);

        expect(takeEventTransactions()).toEqual([]);
    }
});

test("can delete and undelete items (with transactions)", async () => {
    const space = await TestSpace.create(context);

    const TestModelSchema = Schema.object({
        type: Schema.string,
        partitionKey: Schema.integer,
        sortKey: Schema.integer,
        attribute: Schema.integer,
    });

    let eventTransactions: Array<
        ReadonlyArray<DynamoGeneralRealtimeEvent<SchemaType<typeof TestModelSchema>>>
    > = [];

    const takeEventTransactions = () => {
        const currentEventTransactions = eventTransactions;
        eventTransactions = [];
        return currentEventTransactions;
    };

    const TestTable = DynamoGeneralRealtimeTableSchema.new({
        withoutCompatibilityErrorsForTest: true,
        name: `Test_${generateId()}`,
        features: {
            deleteItem: {PartitionA: {SortRangeA2: true}},
        },
        partitions: [
            {
                name: "PartitionA",
                partitionKeyAttributes: {
                    partitionAKey: DynamoKeyAttributeSchema.integer,
                },
                sortRanges: [
                    {
                        name: "SortRangeA1",
                        sortKeyAttributes: {
                            sortA1Key: DynamoKeyAttributeSchema.integer,
                        },
                        attributes: Schema.object({
                            attribute: Schema.integer,
                        }),
                    },
                    {
                        name: "SortRangeA2",
                        sortKeyAttributes: {
                            sortA2Key: DynamoKeyAttributeSchema.integer,
                        },
                        attributes: Schema.object({
                            attribute: Schema.integer,
                        }),
                    },
                ],
            },
            {
                name: "PartitionB",
                partitionKeyAttributes: {
                    partitionBKey: DynamoKeyAttributeSchema.integer,
                },
                sortRanges: [
                    {
                        name: "SortRangeB1",
                        sortKeyAttributes: {
                            sortB1Key: DynamoKeyAttributeSchema.integer,
                        },
                        attributes: Schema.object({
                            attribute: Schema.integer,
                        }),
                    },
                ],
            },
        ],
        modelSchema: TestModelSchema,
        models: {
            PartitionA: {
                SortRangeA1: {
                    build: async (context, item) => ({
                        type: "ItemA1",
                        partitionKey: item.partitionAKey,
                        sortKey: item.sortA1Key,
                        attribute: item.attribute,
                    }),
                },
                SortRangeA2: {
                    build: async (context, item) => ({
                        type: "ItemA2",
                        partitionKey: item.partitionAKey,
                        sortKey: item.sortA2Key,
                        attribute: item.attribute,
                    }),
                },
            },
            PartitionB: {
                SortRangeB1: {
                    build: async (context, item) => ({
                        type: "ItemB1",
                        partitionKey: item.partitionBKey,
                        sortKey: item.sortB1Key,
                        attribute: item.attribute,
                    }),
                },
            },
        },
        broadcastEventTransaction: async (context, readTime, eventTransaction) => {
            eventTransactions.push(eventTransaction.map(({event}) => event));
        },
    });

    finishInitializingDynamoTableSchemas();

    expect(takeEventTransactions()).toEqual([]);

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual(null);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
                attribute: 3,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------08F3--7---------1",
                        version: 0,
                        model: {
                            type: "ItemA1",
                            partitionKey: 1,
                            sortKey: 2,
                            attribute: 3,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 6,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 0,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 6,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
                attribute: 9,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-N---------68F3--7---------7",
                        version: 0,
                        model: {
                            type: "ItemB1",
                            partitionKey: 7,
                            sortKey: 8,
                            attribute: 9,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 12,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 0,
                        model: {
                            type: "ItemA2",
                            partitionKey: 10,
                            sortKey: 11,
                            attribute: 12,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);
    }

    {
        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 13,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 1,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 13,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 14,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 14,
                updateLockVersion: 1,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 2,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 14,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 2,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        expect(() =>
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
                attribute: 3,
            }),
        ).toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        expect(() =>
            TestTable.transactionDeleteItem({
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
                attribute: 9,
            }),
        ).toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 12,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 1,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 1,
                    sortA2Key: 2,
                    attribute: 3,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 6,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 13,
                    updateLockVersion: 1,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 14,
                updateLockVersion: 2,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 3,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 14,
                    updateLockVersion: 2,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toEqual({updateLockVersion: 3});

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toEqual({updateLockVersion: 1});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual(null);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        expect(() =>
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 0},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                    attribute: 15,
                },
            ),
        ).toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        expect(() =>
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 0},
                {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                    attribute: 16,
                },
            ),
        ).toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: undefined},
                    {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                        attribute: 17,
                    },
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 1},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 18,
                },
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 2,
                        model: {
                            type: "ItemA2",
                            partitionKey: 10,
                            sortKey: 11,
                            attribute: 18,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 2},
                    {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                        attribute: 19,
                    },
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 3},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 20,
                },
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 4,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 20,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 3},
                    {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                        attribute: 21,
                    },
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 4},
                    {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                        attribute: 21,
                    },
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 20,
            updateLockVersion: 4,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 18,
            updateLockVersion: 2,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 22,
                updateLockVersion: 4,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 5,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 22,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 23,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 24,
                    updateLockVersion: 1,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 25,
                updateLockVersion: 2,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 3,
                        model: {
                            type: "ItemA2",
                            partitionKey: 10,
                            sortKey: 11,
                            attribute: 25,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);
    }

    {
        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionA`, sort range type: `SortRangeA1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).rejects.toThrow(
            new InternalError(
                "Deleted items are disabled (partition type: `PartitionB`, sort range type: `SortRangeB1`)",
            ),
        );

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).resolves.toBeNull();

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 5,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
            }),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
        });

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 7,
                sortA2Key: 8,
            }),
        ).toEqual(null);

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }

    {
        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 22,
                updateLockVersion: 5,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 6,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toEqual({updateLockVersion: 6});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionCreateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 23,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionCreateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 23,
                    updateLockVersion: 6,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 6},
                {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 24,
                },
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 7,
                        model: {
                            type: "ItemA2",
                            partitionKey: 4,
                            sortKey: 5,
                            attribute: 24,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.getDeletedItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).resolves.toBeNull();

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 24,
            updateLockVersion: 7,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventTransactions()).toEqual([]);
    }
});

test("can update a property that’s in an index’s partition key and a put event will show up in the old query’s backfill", async () => {
    import.meta.jest.useFakeTimers();

    try {
        const space = await TestSpace.create(context);

        const TestModelSchema = Schema.object({
            partitionKey: Schema.integer,
            sortKey: Schema.integer,
            attribute1: Schema.integer,
            attribute2: Schema.integer,
        });

        let eventTransactions: Array<
            ReadonlyArray<DynamoGeneralRealtimeEvent<SchemaType<typeof TestModelSchema>>>
        > = [];

        const takeEventTransactions = () => {
            const currentEventTransactions = eventTransactions;
            eventTransactions = [];
            return currentEventTransactions;
        };

        const TestTable = DynamoGeneralRealtimeTableSchema.new({
            withoutCompatibilityErrorsForTest: true,
            name: `Test_${generateId()}`,
            partitions: [
                {
                    name: "Partition",
                    partitionKeyAttributes: {
                        testPartitionKey: DynamoKeyAttributeSchema.integer,
                    },
                    sortRanges: [
                        {
                            name: "SortRange",
                            sortKeyAttributes: {
                                testSortKey: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                attribute1: Schema.integer,
                                attribute2: Schema.integer,
                            }),
                        },
                    ],
                },
            ],
            modelSchema: TestModelSchema,
            models: {
                Partition: {
                    SortRange: {
                        build: async (context, item) => ({
                            partitionKey: item.testPartitionKey,
                            sortKey: item.testSortKey,
                            attribute1: item.attribute1,
                            attribute2: item.attribute2,
                        }),
                    },
                },
            },
            broadcastEventTransaction: async (context, readTime, eventTransaction) => {
                eventTransactions.push(eventTransaction.map(({event}) => event));
            },
        });

        const TestIndex = TestTable.addExpensiveFullIndex({
            name: "Index",
            itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
            partitionKeyAttributes: {
                attribute1: DynamoKeyAttributeSchema.integer,
            },
            sortKeyAttributes: {
                attribute2: DynamoKeyAttributeSchema.integer,
            },
        });

        finishInitializingDynamoTableSchemas();

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 2,
            attribute1: 100,
            attribute2: 101,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 3,
            attribute1: 102,
            attribute2: 104,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 4,
            testSortKey: 5,
            attribute1: 102,
            attribute2: 103,
        });

        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

        const readTime = new Date();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5R0-7---------38F3--7---------4",
                    key: "-7---------38F3--7---------4",
                    version: 0,
                    model: {
                        partitionKey: 4,
                        sortKey: 5,
                        attribute1: 102,
                        attribute2: 103,
                    },
                },
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 100,
                attribute2: 103,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        await expect(
            TestTable.directlyUpdateItem(
                space.systemAction(),
                {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                },
                {
                    oldItem: {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    },
                },
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        await expect(
            TestTable.directlyUpdateItem(
                space.systemAction(),
                {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                },
                {
                    oldItem: {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 123456789,
                        attribute2: 103,
                    },
                },
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            {
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 100,
                attribute2: 103,
            },
            {
                oldItem: {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 102,
                    attribute2: 103,
                },
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
                {
                    cursor: "V--------5R0-7---------38F3--7---------4",
                    key: "-7---------38F3--7---------4",
                    version: 1,
                    model: {
                        partitionKey: 4,
                        sortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F3--7---------4",
                        version: 1,
                        model: {
                            partitionKey: 4,
                            sortKey: 5,
                            attribute1: 100,
                            attribute2: 103,
                        },
                    },
                    indexes: new Map([
                        [
                            "Index",
                            {
                                partitionKey: "V--------5F",
                                cursor: "V--------5R0-7---------38F3--7---------4",
                            },
                        ],
                    ]),
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F3--7---------4",
                        version: 1,
                    },
                    indexes: new Set(["Index"]),
                },
            ],
        });

        expect(takeEventTransactions().length).toEqual(4);
    } finally {
        import.meta.jest.useRealTimers();
    }
});

test("can delete an item with a property in an index’s partition key that can be updated and a delete event will show up in the old query’s backfill", async () => {
    import.meta.jest.useFakeTimers();

    try {
        const space = await TestSpace.create(context);

        const TestModelSchema = Schema.object({
            partitionKey: Schema.integer,
            sortKey: Schema.integer,
            attribute1: Schema.integer,
            attribute2: Schema.integer,
        });

        let eventTransactions: Array<
            ReadonlyArray<DynamoGeneralRealtimeEvent<SchemaType<typeof TestModelSchema>>>
        > = [];

        const takeEventTransactions = () => {
            const currentEventTransactions = eventTransactions;
            eventTransactions = [];
            return currentEventTransactions;
        };

        const TestTable = DynamoGeneralRealtimeTableSchema.new({
            withoutCompatibilityErrorsForTest: true,
            features: {deleteItem: {Partition: {SortRange: true}}},
            name: `Test_${generateId()}`,
            partitions: [
                {
                    name: "Partition",
                    partitionKeyAttributes: {
                        testPartitionKey: DynamoKeyAttributeSchema.integer,
                    },
                    sortRanges: [
                        {
                            name: "SortRange",
                            sortKeyAttributes: {
                                testSortKey: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                attribute1: Schema.integer,
                                attribute2: Schema.integer,
                            }),
                        },
                    ],
                },
            ],
            modelSchema: TestModelSchema,
            models: {
                Partition: {
                    SortRange: {
                        build: async (context, item) => ({
                            partitionKey: item.testPartitionKey,
                            sortKey: item.testSortKey,
                            attribute1: item.attribute1,
                            attribute2: item.attribute2,
                        }),
                    },
                },
            },
            broadcastEventTransaction: async (context, readTime, eventTransaction) => {
                eventTransactions.push(eventTransaction.map(({event}) => event));
            },
        });

        const TestIndex = TestTable.addExpensiveFullIndex({
            name: "Index",
            itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
            partitionKeyAttributes: {
                attribute1: DynamoKeyAttributeSchema.integer,
            },
            sortKeyAttributes: {
                attribute2: DynamoKeyAttributeSchema.integer,
            },
        });

        finishInitializingDynamoTableSchemas();

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 2,
            attribute1: 100,
            attribute2: 101,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 3,
            attribute1: 102,
            attribute2: 104,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 4,
            testSortKey: 5,
            attribute1: 102,
            attribute2: 103,
        });

        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

        const readTime = new Date();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5R0-7---------38F3--7---------4",
                    key: "-7---------38F3--7---------4",
                    version: 0,
                    model: {
                        partitionKey: 4,
                        sortKey: 5,
                        attribute1: 102,
                        attribute2: 103,
                    },
                },
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 100,
                attribute2: 103,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 123456789,
                attribute2: 103,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 4,
            testSortKey: 5,
            attribute1: 102,
            attribute2: 103,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F3--7---------4",
                        version: 1,
                    },
                    indexes: new Set(["Index"]),
                },
            ],
        });

        expect(takeEventTransactions().length).toEqual(4);
    } finally {
        import.meta.jest.useRealTimers();
    }
});

test("can update a property that’s in an index’s partition key and a put event will show up in the old query’s backfill (with transactions)", async () => {
    import.meta.jest.useFakeTimers();

    try {
        const space = await TestSpace.create(context);

        const TestModelSchema = Schema.object({
            partitionKey: Schema.integer,
            sortKey: Schema.integer,
            attribute1: Schema.integer,
            attribute2: Schema.integer,
        });

        let eventTransactions: Array<
            ReadonlyArray<DynamoGeneralRealtimeEvent<SchemaType<typeof TestModelSchema>>>
        > = [];

        const takeEventTransactions = () => {
            const currentEventTransactions = eventTransactions;
            eventTransactions = [];
            return currentEventTransactions;
        };

        const TestTable = DynamoGeneralRealtimeTableSchema.new({
            withoutCompatibilityErrorsForTest: true,
            name: `Test_${generateId()}`,
            partitions: [
                {
                    name: "Partition",
                    partitionKeyAttributes: {
                        testPartitionKey: DynamoKeyAttributeSchema.integer,
                    },
                    sortRanges: [
                        {
                            name: "SortRange",
                            sortKeyAttributes: {
                                testSortKey: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                attribute1: Schema.integer,
                                attribute2: Schema.integer,
                            }),
                        },
                    ],
                },
            ],
            modelSchema: TestModelSchema,
            models: {
                Partition: {
                    SortRange: {
                        build: async (context, item) => ({
                            partitionKey: item.testPartitionKey,
                            sortKey: item.testSortKey,
                            attribute1: item.attribute1,
                            attribute2: item.attribute2,
                        }),
                    },
                },
            },
            broadcastEventTransaction: async (context, readTime, eventTransaction) => {
                eventTransactions.push(eventTransaction.map(({event}) => event));
            },
        });

        const TestIndex = TestTable.addExpensiveFullIndex({
            name: "Index",
            itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
            partitionKeyAttributes: {
                attribute1: DynamoKeyAttributeSchema.integer,
            },
            sortKeyAttributes: {
                attribute2: DynamoKeyAttributeSchema.integer,
            },
        });

        finishInitializingDynamoTableSchemas();

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 2,
            attribute1: 100,
            attribute2: 101,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 3,
            attribute1: 102,
            attribute2: 104,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 4,
            testSortKey: 5,
            attribute1: 102,
            attribute2: 103,
        });

        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

        const readTime = new Date();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5R0-7---------38F3--7---------4",
                    key: "-7---------38F3--7---------4",
                    version: 0,
                    model: {
                        partitionKey: 4,
                        sortKey: 5,
                        attribute1: 102,
                        attribute2: 103,
                    },
                },
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(
                    {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    },
                    {
                        oldItem: {
                            partitionType: "Partition",
                            sortRangeType: "SortRange",
                            testPartitionKey: 4,
                            testSortKey: 5,
                            attribute1: 100,
                            attribute2: 103,
                        },
                    },
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(
                    {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    },
                    {
                        oldItem: {
                            partitionType: "Partition",
                            sortRangeType: "SortRange",
                            testPartitionKey: 4,
                            testSortKey: 5,
                            attribute1: 123456789,
                            attribute2: 103,
                        },
                    },
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                },
                {
                    oldItem: {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 102,
                        attribute2: 103,
                    },
                },
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
                {
                    cursor: "V--------5R0-7---------38F3--7---------4",
                    key: "-7---------38F3--7---------4",
                    version: 1,
                    model: {
                        partitionKey: 4,
                        sortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F3--7---------4",
                        version: 1,
                        model: {
                            partitionKey: 4,
                            sortKey: 5,
                            attribute1: 100,
                            attribute2: 103,
                        },
                    },
                    indexes: new Map([
                        [
                            "Index",
                            {
                                partitionKey: "V--------5F",
                                cursor: "V--------5R0-7---------38F3--7---------4",
                            },
                        ],
                    ]),
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F3--7---------4",
                        version: 1,
                    },
                    indexes: new Set(["Index"]),
                },
            ],
        });

        expect(takeEventTransactions().length).toEqual(4);
    } finally {
        import.meta.jest.useRealTimers();
    }
});

test("can delete an item with a property in an index’s partition key that can be updated and a delete event will show up in the old query’s backfill (with transactions)", async () => {
    import.meta.jest.useFakeTimers();

    try {
        const space = await TestSpace.create(context);

        const TestModelSchema = Schema.object({
            partitionKey: Schema.integer,
            sortKey: Schema.integer,
            attribute1: Schema.integer,
            attribute2: Schema.integer,
        });

        let eventTransactions: Array<
            ReadonlyArray<DynamoGeneralRealtimeEvent<SchemaType<typeof TestModelSchema>>>
        > = [];

        const takeEventTransactions = () => {
            const currentEventTransactions = eventTransactions;
            eventTransactions = [];
            return currentEventTransactions;
        };

        const TestTable = DynamoGeneralRealtimeTableSchema.new({
            withoutCompatibilityErrorsForTest: true,
            features: {deleteItem: {Partition: {SortRange: true}}},
            name: `Test_${generateId()}`,
            partitions: [
                {
                    name: "Partition",
                    partitionKeyAttributes: {
                        testPartitionKey: DynamoKeyAttributeSchema.integer,
                    },
                    sortRanges: [
                        {
                            name: "SortRange",
                            sortKeyAttributes: {
                                testSortKey: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                attribute1: Schema.integer,
                                attribute2: Schema.integer,
                            }),
                        },
                    ],
                },
            ],
            modelSchema: TestModelSchema,
            models: {
                Partition: {
                    SortRange: {
                        build: async (context, item) => ({
                            partitionKey: item.testPartitionKey,
                            sortKey: item.testSortKey,
                            attribute1: item.attribute1,
                            attribute2: item.attribute2,
                        }),
                    },
                },
            },
            broadcastEventTransaction: async (context, readTime, eventTransaction) => {
                eventTransactions.push(eventTransaction.map(({event}) => event));
            },
        });

        const TestIndex = TestTable.addExpensiveFullIndex({
            name: "Index",
            itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
            partitionKeyAttributes: {
                attribute1: DynamoKeyAttributeSchema.integer,
            },
            sortKeyAttributes: {
                attribute2: DynamoKeyAttributeSchema.integer,
            },
        });

        finishInitializingDynamoTableSchemas();

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 2,
            attribute1: 100,
            attribute2: 101,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 3,
            attribute1: 102,
            attribute2: 104,
        });

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 4,
            testSortKey: 5,
            attribute1: 102,
            attribute2: 103,
        });

        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

        const readTime = new Date();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5R0-7---------38F3--7---------4",
                    key: "-7---------38F3--7---------4",
                    version: 0,
                    model: {
                        partitionKey: 4,
                        sortKey: 5,
                        attribute1: 102,
                        attribute2: 103,
                    },
                },
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await expect(
            DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 123456789,
                    attribute2: 103,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await DynamoGeneralRealtimeTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 102,
                attribute2: 103,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5F",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5J0-7---------08F3--7---------1",
                    key: "-7---------08F3--7---------1",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 2,
                        attribute1: 100,
                        attribute2: 101,
                    },
                },
            ],
        });

        expect(
            await TestIndex.realtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                limit: "All",
            }),
        ).toEqual({
            readTime: expect.any(Date),
            indexName: "Index",
            partitionKey: "V--------5N",
            startCursorBound: null,
            endCursorBound: null,
            pageInfo: {
                type: "FromStart",
                hasNextPage: false,
                afterCursor: null,
            },
            items: [
                {
                    cursor: "V--------5V0-7---------08F3--7---------2",
                    key: "-7---------08F3--7---------2",
                    version: 0,
                    model: {
                        partitionKey: 1,
                        sortKey: 3,
                        attribute1: 102,
                        attribute2: 104,
                    },
                },
            ],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 100},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [],
        });

        expect(
            await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                partitionKey: {attribute1: 102},
                readTime,
            }),
        ).toEqual({
            type: "Available",
            readTime: expect.any(Date),
            eventTransaction: [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F3--7---------4",
                        version: 1,
                    },
                    indexes: new Set(["Index"]),
                },
            ],
        });

        expect(takeEventTransactions().length).toEqual(4);
    } finally {
        import.meta.jest.useRealTimers();
    }
});
