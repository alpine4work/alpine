import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoItem,
    finishInitializingDynamoTableSchemas,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const context = createTestContext();

function omitOldItem(item: any): any {
    return omitObject(item, ["oldItem"]);
}

test("can delete and undelete items", async () => {
    const space = await TestSpace.create(context);

    const TestModelSchema = Schema.object({
        type: Schema.string,
        partitionKey: Schema.integer,
        sortKey: Schema.integer,
        attribute: Schema.integer,
    });

    let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

    const takeEventss = () => {
        const currentEventss = eventss;
        eventss = [];
        return currentEventss;
    };

    const TestTable = RynamoTableSchema.new({
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
        broadcastEvents: async (context, events) => {
            eventss.push(await runAllPromises(events.map(({getEvent}) => getEvent(context))));
        },
    });

    finishInitializingDynamoTableSchemas();

    const {getCount: getPutItemCount} =
        dynamoClientExecuteActionTestCounter.recordForTest("PutItem");

    const {getCount: getTransactWriteItemsCount} =
        dynamoClientExecuteActionTestCounter.recordForTest("TransactWriteItems");

    expect(getPutItemCount()).toEqual(0);
    expect(getTransactWriteItemsCount()).toEqual(0);

    expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([
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

        expect(takeEventss()).toEqual([
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

        expect(takeEventss()).toEqual([
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

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 1,
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
        const oldItem = await TestTable.getItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
        });

        await TestTable.directlyUpdateItem(space.systemAction(), oldItem.update({attribute: 13}));

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(3);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([
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
                            attribute: 13,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), oldItem.update({attribute: 13})),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(4);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([]);

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            (
                await TestTable.getItem(context, {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                })
            ).update({
                attribute: 14,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 3,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(3);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 2,
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 13,
                updateLockVersion: 2,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(6);

        expect(takeEventss()).toEqual([]);

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(7);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 4,
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

        expect(takeEventss()).toEqual([]);
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
        ).resolves.toEqual({updateLockVersion: 4});

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
        ).resolves.toEqual({updateLockVersion: 2});

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 1},
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

        expect(takeEventss()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 2},
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

        expect(takeEventss()).toEqual([
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
                {updateLockVersion: 3},
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

        expect(takeEventss()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 4},
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

        expect(takeEventss()).toEqual([
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
        expect(getTransactWriteItemsCount()).toEqual(13);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 5},
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

        expect(takeEventss()).toEqual([]);
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 20,
            updateLockVersion: 5,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 18,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventss()).toEqual([]);
    }

    {
        const oldItem = await TestTable.getItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
        });

        await TestTable.directlyUpdateItem(space.systemAction(), oldItem.update({attribute: 22}));

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(6);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 6,
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
            TestTable.directlyUpdateItem(
                space.systemAction(),
                DynamoItem.create({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 23,
                }),
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        expect(getPutItemCount()).toEqual(6);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 24,
                updateLockVersion: 2,
                // @ts-expect-error: HACK
                oldItem: {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    updateLockVersion: 2,
                },
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(7);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([]);

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            (
                await TestTable.getItem(context, {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                })
            ).update({
                attribute: 25,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 4,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 6,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 4,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([]);
    }

    {
        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 6,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(16);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 7,
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
        ).resolves.toEqual({updateLockVersion: 7});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(16);

        expect(takeEventss()).toEqual([]);

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

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(17);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.createItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 23,
                updateLockVersion: 7,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(18);

        expect(takeEventss()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 7},
            {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 24,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(19);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 8,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 24,
            updateLockVersion: 8,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(19);

        expect(takeEventss()).toEqual([]);
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

    let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

    const takeEventss = () => {
        const currentEventss = eventss;
        eventss = [];
        return currentEventss;
    };

    const TestTable = RynamoTableSchema.new({
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
        broadcastEvents: async (context, events) => {
            eventss.push(await runAllPromises(events.map(({getEvent}) => getEvent(context))));
        },
    });

    finishInitializingDynamoTableSchemas();

    expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);
    }

    {
        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
                attribute: 3,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
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

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 6,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
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
                            attribute: 6,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
                attribute: 9,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
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

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionCreateItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 12,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 1,
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
        const oldItem = await TestTable.getItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
        });

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(oldItem.update({attribute: 13})),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
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
                            attribute: 13,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(oldItem.update({attribute: 14})),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                (
                    await TestTable.getItem(context, {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                    })
                ).update({
                    attribute: 14,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 3,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 12,
                updateLockVersion: 1,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 2,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 1,
                    sortA2Key: 2,
                    attribute: 3,
                    updateLockVersion: 1,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 6,
                    updateLockVersion: 1,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 13,
                    updateLockVersion: 2,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 14,
                updateLockVersion: 3,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 4,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 14,
                    updateLockVersion: 3,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
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
        ).resolves.toEqual({updateLockVersion: 4});

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
        ).resolves.toEqual({updateLockVersion: 2});

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 1},
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

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 2},
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

        expect(takeEventss()).toEqual([
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
                            attribute: 18,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 3},
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

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 4},
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

        expect(takeEventss()).toEqual([
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
                            attribute: 20,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
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

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 5},
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

        expect(takeEventss()).toEqual([]);
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 20,
            updateLockVersion: 5,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 18,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
    }

    {
        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                (
                    await TestTable.getItem(context, {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                    })
                ).update({
                    attribute: 22,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 6,
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
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(
                    DynamoItem.create({
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                        attribute: 23,
                    }),
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 24,
                    updateLockVersion: 2,
                    // @ts-expect-error: HACK
                    oldItem: {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                        updateLockVersion: 2,
                    },
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                (
                    await TestTable.getItem(context, {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                    })
                ).update({
                    attribute: 25,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 4,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 6,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 4,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
    }

    {
        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 22,
                updateLockVersion: 6,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 7,
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
        ).resolves.toEqual({updateLockVersion: 7});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
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

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionCreateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 23,
                    updateLockVersion: 7,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 7},
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

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 8,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 24,
            updateLockVersion: 8,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
    }
});

test("can delete and undelete items (with `directlyUpdateItem()`)", async () => {
    const space = await TestSpace.create(context);

    const TestModelSchema = Schema.object({
        type: Schema.string,
        partitionKey: Schema.integer,
        sortKey: Schema.integer,
        attribute: Schema.integer,
    });

    let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

    const takeEventss = () => {
        const currentEventss = eventss;
        eventss = [];
        return currentEventss;
    };

    const TestTable = RynamoTableSchema.new({
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
        broadcastEvents: async (context, events) => {
            eventss.push(await runAllPromises(events.map(({getEvent}) => getEvent(context))));
        },
    });

    finishInitializingDynamoTableSchemas();

    dynamoClientExecuteActionTestCounter.resetForTest();

    const {getCount: getPutItemCount} =
        dynamoClientExecuteActionTestCounter.recordForTest("PutItem");

    const {getCount: getTransactWriteItemsCount} =
        dynamoClientExecuteActionTestCounter.recordForTest("TransactWriteItems");

    expect(getPutItemCount()).toEqual(0);
    expect(getTransactWriteItemsCount()).toEqual(0);

    expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);
    }

    {
        await TestTable.directlyUpdateItem(
            space.systemAction(),
            DynamoItem.create({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA1",
                partitionAKey: 1,
                sortA1Key: 2,
                attribute: 3,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(1);
        expect(getTransactWriteItemsCount()).toEqual(0);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------08F3--7---------1",
                        version: 1,
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

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            DynamoItem.create({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 6,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(1);
        expect(getTransactWriteItemsCount()).toEqual(1);

        expect(takeEventss()).toEqual([
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
                            attribute: 6,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            DynamoItem.create({
                partitionType: "PartitionB",
                sortRangeType: "SortRangeB1",
                partitionBKey: 7,
                sortB1Key: 8,
                attribute: 9,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(2);
        expect(getTransactWriteItemsCount()).toEqual(1);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-N---------68F3--7---------7",
                        version: 1,
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

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            DynamoItem.create({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 12,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(2);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 1,
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
        const oldItem = await TestTable.getItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
        });

        await TestTable.directlyUpdateItem(space.systemAction(), oldItem.update({attribute: 13}));

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(3);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([
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
                            attribute: 13,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), oldItem.update({attribute: 14})),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(4);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([]);

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            (
                await TestTable.getItem(context, {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                })
            ).update({
                attribute: 14,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 3,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(2);

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(3);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 2,
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.deleteItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 13,
                updateLockVersion: 2,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(6);

        expect(takeEventss()).toEqual([]);

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(7);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 4,
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

        expect(takeEventss()).toEqual([]);
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
        ).resolves.toEqual({updateLockVersion: 4});

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
        ).resolves.toEqual({updateLockVersion: 2});

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 1},
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

        expect(takeEventss()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 2},
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

        expect(takeEventss()).toEqual([
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
                {updateLockVersion: 3},
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

        expect(takeEventss()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 4},
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

        expect(takeEventss()).toEqual([
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
        expect(getTransactWriteItemsCount()).toEqual(13);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.undeleteItem(
                space.systemAction(),
                {updateLockVersion: 5},
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

        expect(takeEventss()).toEqual([]);
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 20,
            updateLockVersion: 5,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 18,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(5);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventss()).toEqual([]);
    }

    {
        await TestTable.directlyUpdateItem(
            space.systemAction(),
            (
                await TestTable.getItem(context, {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                })
            ).update({
                attribute: 22,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(6);
        expect(getTransactWriteItemsCount()).toEqual(14);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 6,
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
            // @ts-expect-error: HACK
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 23,
                oldItem: null,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        expect(getPutItemCount()).toEqual(6);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 24,
                updateLockVersion: 2,
                // @ts-expect-error: HACK
                oldItem: {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    updateLockVersion: 2,
                },
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        expect(getPutItemCount()).toEqual(7);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([]);

        await TestTable.directlyUpdateItem(
            space.systemAction(),
            (
                await TestTable.getItem(context, {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                })
            ).update({
                attribute: 25,
            }),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 4,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 6,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 4,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(15);

        expect(takeEventss()).toEqual([]);
    }

    {
        const oldItem = await TestTable.getItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
        });

        await TestTable.deleteItem(space.systemAction(), {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 6,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(16);

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 7,
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
        ).resolves.toEqual({updateLockVersion: 7});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(16);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.directlyUpdateItem(
                space.systemAction(),
                DynamoItem.create({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 23,
                }),
            ),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(8);
        expect(getTransactWriteItemsCount()).toEqual(17);

        expect(takeEventss()).toEqual([]);

        await expect(
            TestTable.directlyUpdateItem(space.systemAction(), oldItem.update({attribute: 24})),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(17);

        expect(takeEventss()).toEqual([]);

        await TestTable.undeleteItem(
            space.systemAction(),
            {updateLockVersion: 7},
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

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 8,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 24,
            updateLockVersion: 8,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(getPutItemCount()).toEqual(9);
        expect(getTransactWriteItemsCount()).toEqual(18);

        expect(takeEventss()).toEqual([]);
    }
});

test("can delete and undelete items (with `transactionDirectlyUpdateItem()`)", async () => {
    const space = await TestSpace.create(context);

    const TestModelSchema = Schema.object({
        type: Schema.string,
        partitionKey: Schema.integer,
        sortKey: Schema.integer,
        attribute: Schema.integer,
    });

    let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

    const takeEventss = () => {
        const currentEventss = eventss;
        eventss = [];
        return currentEventss;
    };

    const TestTable = RynamoTableSchema.new({
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
        broadcastEvents: async (context, events) => {
            eventss.push(await runAllPromises(events.map(({getEvent}) => getEvent(context))));
        },
    });

    finishInitializingDynamoTableSchemas();

    expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);
    }

    {
        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                DynamoItem.create({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                    attribute: 3,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------08F3--7---------1",
                        version: 1,
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

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                DynamoItem.create({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 6,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
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
                            attribute: 6,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                DynamoItem.create({
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                    attribute: 9,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-N---------68F3--7---------7",
                        version: 1,
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

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                DynamoItem.create({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 12,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 1,
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
        const oldItem = await TestTable.getItem(context, {
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
        });

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(oldItem.update({attribute: 13})),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
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
                            attribute: 13,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(oldItem.update({attribute: 14})),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                (
                    await TestTable.getItem(context, {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                    })
                ).update({
                    attribute: 14,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 3,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 14,
            updateLockVersion: 3,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 12,
            updateLockVersion: 1,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 10,
                sortA2Key: 11,
                attribute: 12,
                updateLockVersion: 1,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 2,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 1,
                    sortA2Key: 2,
                    attribute: 3,
                    updateLockVersion: 1,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 6,
                    updateLockVersion: 1,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 13,
                    updateLockVersion: 2,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 14,
                updateLockVersion: 3,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 4,
                    },
                    indexes: new Set(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 14,
                    updateLockVersion: 3,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
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
        ).resolves.toEqual({updateLockVersion: 4});

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
        ).resolves.toEqual({updateLockVersion: 2});

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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

        expect(takeEventss()).toEqual([]);
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

        expect(takeEventss()).toEqual([]);

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

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 1},
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

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 2},
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

        expect(takeEventss()).toEqual([
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
                            attribute: 18,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 3},
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

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 4},
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

        expect(takeEventss()).toEqual([
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
                            attribute: 20,
                        },
                    },
                    indexes: new Map(),
                },
            ],
        ]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
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

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionUndeleteItem(
                    {updateLockVersion: 5},
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

        expect(takeEventss()).toEqual([]);
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 20,
            updateLockVersion: 5,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 18,
            updateLockVersion: 3,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
    }

    {
        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                (
                    await TestTable.getItem(context, {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                    })
                ).update({
                    attribute: 22,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 6,
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
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(
                    DynamoItem.create({
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                        attribute: 23,
                    }),
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]",
            ),
        );

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                    attribute: 24,
                    updateLockVersion: 2,
                    // @ts-expect-error: HACK
                    oldItem: {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                        updateLockVersion: 2,
                    },
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDirectlyUpdateItem(
                (
                    await TestTable.getItem(context, {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 10,
                        sortA2Key: 11,
                    })
                ).update({
                    attribute: 25,
                }),
            ),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------98F7--N---------A",
                        version: 4,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA1",
                    partitionAKey: 1,
                    sortA1Key: 2,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA1",
            partitionAKey: 1,
            sortA1Key: 2,
            attribute: 3,
            updateLockVersion: 1,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 22,
            updateLockVersion: 6,
        });

        expect(
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionB",
                    sortRangeType: "SortRangeB1",
                    partitionBKey: 7,
                    sortB1Key: 8,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionB",
            sortRangeType: "SortRangeB1",
            partitionBKey: 7,
            sortB1Key: 8,
            attribute: 9,
            updateLockVersion: 1,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 10,
                    sortA2Key: 11,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 10,
            sortA2Key: 11,
            attribute: 25,
            updateLockVersion: 4,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
    }

    {
        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionDeleteItem({
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
                attribute: 22,
                updateLockVersion: 6,
            }),
        ]);

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([
            [
                {
                    type: "DeleteItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 7,
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
        ).resolves.toEqual({updateLockVersion: 7});

        expect(
            await TestTable.getItemIfExists(space.systemAction(), {
                partitionType: "PartitionA",
                sortRangeType: "SortRangeA2",
                partitionAKey: 4,
                sortA2Key: 5,
            }),
        ).toEqual(null);

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem(
                    DynamoItem.create({
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                        attribute: 23,
                    }),
                ),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await expect(
            RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                    attribute: 23,
                    updateLockVersion: 7,
                    // @ts-expect-error: HACK
                    oldItem: {
                        partitionType: "PartitionA",
                        sortRangeType: "SortRangeA2",
                        partitionAKey: 4,
                        sortA2Key: 5,
                        updateLockVersion: 7,
                    },
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);

        await RynamoTableSchema.executeTransaction(space.systemAction(), [
            TestTable.transactionUndeleteItem(
                {updateLockVersion: 7},
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

        expect(takeEventss()).toEqual([
            [
                {
                    type: "PutItem",
                    item: {
                        key: "-7---------38F7--N---------4",
                        version: 8,
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
            omitOldItem(
                await TestTable.getItem(space.systemAction(), {
                    partitionType: "PartitionA",
                    sortRangeType: "SortRangeA2",
                    partitionAKey: 4,
                    sortA2Key: 5,
                }),
            ),
        ).toEqual({
            partitionType: "PartitionA",
            sortRangeType: "SortRangeA2",
            partitionAKey: 4,
            sortA2Key: 5,
            attribute: 24,
            updateLockVersion: 8,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(takeEventss()).toEqual([]);
    }
});

type TestIndexKind = (typeof testIndexKinds)[number];

const testIndexKinds = [
    "eventual consistency join index",
    "eventual consistency full index",
    "strong consistency join index",
] as const;

describe.each(testIndexKinds)("%s", (indexKind: TestIndexKind) => {
    const testIndexCursorForPartition1Sort2 =
        indexKind === "strong consistency join index"
            ? "V--------5L----------N---------1-F-_-F--"
            : "V--------5J0-7---------08F3--7---------1";

    const testIndexCursorForPartition1Sort3 =
        indexKind === "strong consistency join index"
            ? "V--------5X----------N---------2-F-_-F--"
            : "V--------5V0-7---------08F3--7---------2";

    const testIndexCursorForPartition4Sort5 =
        indexKind === "strong consistency join index"
            ? "V--------5T---------07---------4-F-_-F--"
            : "V--------5R0-7---------38F3--7---------4";

    const directlyUpdateCreateItemFailedPreconditionMessage =
        indexKind === "strong consistency join index"
            ? "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]"
            : "DynamoDB ConditionalCheckFailedException: The conditional request failed";

    const directlyUpdateMovedIndexFailedPreconditionMessage =
        indexKind === "strong consistency join index"
            ? "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None, None]"
            : "DynamoDB ConditionalCheckFailedException: The conditional request failed";

    const deleteItemFailedPreconditionMessage =
        indexKind === "strong consistency join index"
            ? "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None, None]"
            : "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]";

    const transactionDirectlyUpdateCreateItemFailedPreconditionMessage =
        indexKind === "strong consistency join index"
            ? "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]"
            : "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]";

    const transactionDirectlyUpdateMovedIndexFailedPreconditionMessage =
        indexKind === "strong consistency join index"
            ? "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None, None]"
            : "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]";

    const eventualConsistencyAssertionMessage = `Assertion failure: \`consistency === ${JSON.stringify("Eventual")}\``;

    test("can update a property that\u2019s in an index\u2019s partition key and a put event will show up in the old query\u2019s backfill", async () => {
        import.meta.jest.useFakeTimers();

        try {
            const space = await TestSpace.create(context);

            const TestModelSchema = Schema.object({
                partitionKey: Schema.integer,
                sortKey: Schema.integer,
                attribute1: Schema.integer,
                attribute2: Schema.integer,
            });

            let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

            const takeEventss = () => {
                const currentEventss = eventss;
                eventss = [];
                return currentEventss;
            };

            const TestTable = RynamoTableSchema.new({
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
                broadcastEvents: async (context, events) => {
                    eventss.push(
                        await runAllPromises(events.map(({getEvent}) => getEvent(context))),
                    );
                },
            });

            let TestIndex;

            switch (indexKind) {
                case "eventual consistency join index": {
                    TestIndex = TestTable.addEventualConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "eventual consistency full index": {
                    TestIndex = TestTable.addExpensiveFullEventualConsistencyIndex({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "strong consistency join index": {
                    TestIndex = TestTable.addStrongConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                            testPartitionKey: DynamoKeyAttributeSchema.integer,
                            testSortKey: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(indexKind);
            }

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

            const checkpoint = generateServerSynchronizationCheckpoint();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition4Sort5,
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
                        cursor: testIndexCursorForPartition1Sort3,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            await expect(
                TestTable.directlyUpdateItem(
                    space.systemAction(),
                    DynamoItem.create({
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    }),
                ),
            ).rejects.toThrow(
                new FailedPreconditionError(directlyUpdateCreateItemFailedPreconditionMessage),
            );

            await expect(
                TestTable.directlyUpdateItem(space.systemAction(), {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                    // @ts-expect-error: HACK
                    oldItem: {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    },
                }),
            ).rejects.toThrow(
                new FailedPreconditionError(
                    "DynamoDB ConditionalCheckFailedException: The conditional request failed",
                ),
            );

            await expect(
                TestTable.directlyUpdateItem(space.systemAction(), {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                    // @ts-expect-error: HACK
                    oldItem: {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 123456789,
                        attribute2: 103,
                    },
                }),
            ).rejects.toThrow(
                new FailedPreconditionError(directlyUpdateMovedIndexFailedPreconditionMessage),
            );

            await TestTable.directlyUpdateItem(space.systemAction(), {
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 100,
                attribute2: 103,
                // @ts-expect-error: HACK
                oldItem: {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 102,
                    attribute2: 103,
                },
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
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
                        cursor: testIndexCursorForPartition4Sort5,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort3,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [
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
                                    cursor: testIndexCursorForPartition4Sort5,
                                },
                            ],
                        ]),
                    },
                ],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [
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

            expect(takeEventss().length).toEqual(4);
        } finally {
            import.meta.jest.useRealTimers();
        }
    });

    test("can delete an item with a property in an index\u2019s partition key that can be updated and a delete event will show up in the old query\u2019s backfill", async () => {
        import.meta.jest.useFakeTimers();

        try {
            const space = await TestSpace.create(context);

            const TestModelSchema = Schema.object({
                partitionKey: Schema.integer,
                sortKey: Schema.integer,
                attribute1: Schema.integer,
                attribute2: Schema.integer,
            });

            let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

            const takeEventss = () => {
                const currentEventss = eventss;
                eventss = [];
                return currentEventss;
            };

            const TestTable = RynamoTableSchema.new({
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
                broadcastEvents: async (context, events) => {
                    eventss.push(
                        await runAllPromises(events.map(({getEvent}) => getEvent(context))),
                    );
                },
            });

            let TestIndex;

            switch (indexKind) {
                case "eventual consistency join index": {
                    TestIndex = TestTable.addEventualConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "eventual consistency full index": {
                    TestIndex = TestTable.addExpensiveFullEventualConsistencyIndex({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "strong consistency join index": {
                    TestIndex = TestTable.addStrongConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                            testPartitionKey: DynamoKeyAttributeSchema.integer,
                            testSortKey: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(indexKind);
            }

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

            const checkpoint = generateServerSynchronizationCheckpoint();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
                        key: "-7---------08F3--7---------1",
                        version: 1,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition4Sort5,
                        key: "-7---------38F3--7---------4",
                        version: 1,
                        model: {
                            partitionKey: 4,
                            sortKey: 5,
                            attribute1: 102,
                            attribute2: 103,
                        },
                    },
                    {
                        cursor: testIndexCursorForPartition1Sort3,
                        key: "-7---------08F3--7---------2",
                        version: 1,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
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
            ).rejects.toThrow(new FailedPreconditionError(deleteItemFailedPreconditionMessage));

            await expect(
                TestTable.deleteItem(space.systemAction(), {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 123456789,
                    attribute2: 103,
                    updateLockVersion: 1,
                }),
            ).rejects.toThrow(new FailedPreconditionError(deleteItemFailedPreconditionMessage));

            await TestTable.deleteItem(space.systemAction(), {
                partitionType: "Partition",
                sortRangeType: "SortRange",
                testPartitionKey: 4,
                testSortKey: 5,
                attribute1: 102,
                attribute2: 103,
                updateLockVersion: 1,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
                        key: "-7---------08F3--7---------1",
                        version: 1,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort3,
                        key: "-7---------08F3--7---------2",
                        version: 1,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [
                    {
                        type: "DeleteItem",
                        item: {
                            key: "-7---------38F3--7---------4",
                            version: 2,
                        },
                        indexes: new Set(["Index"]),
                    },
                ],
            });

            expect(takeEventss().length).toEqual(4);
        } finally {
            import.meta.jest.useRealTimers();
        }
    });

    test("can update a property that\u2019s in an index\u2019s partition key and a put event will show up in the old query\u2019s backfill (with transactions)", async () => {
        import.meta.jest.useFakeTimers();

        try {
            const space = await TestSpace.create(context);

            const TestModelSchema = Schema.object({
                partitionKey: Schema.integer,
                sortKey: Schema.integer,
                attribute1: Schema.integer,
                attribute2: Schema.integer,
            });

            let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

            const takeEventss = () => {
                const currentEventss = eventss;
                eventss = [];
                return currentEventss;
            };

            const TestTable = RynamoTableSchema.new({
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
                broadcastEvents: async (context, events) => {
                    eventss.push(
                        await runAllPromises(events.map(({getEvent}) => getEvent(context))),
                    );
                },
            });

            let TestIndex;

            switch (indexKind) {
                case "eventual consistency join index": {
                    TestIndex = TestTable.addEventualConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "eventual consistency full index": {
                    TestIndex = TestTable.addExpensiveFullEventualConsistencyIndex({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "strong consistency join index": {
                    TestIndex = TestTable.addStrongConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                            testPartitionKey: DynamoKeyAttributeSchema.integer,
                            testSortKey: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(indexKind);
            }

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

            const checkpoint = generateServerSynchronizationCheckpoint();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition4Sort5,
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
                        cursor: testIndexCursorForPartition1Sort3,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            await expect(
                RynamoTableSchema.executeTransaction(space.systemAction(), [
                    TestTable.transactionDirectlyUpdateItem(
                        DynamoItem.create({
                            partitionType: "Partition",
                            sortRangeType: "SortRange",
                            testPartitionKey: 4,
                            testSortKey: 5,
                            attribute1: 100,
                            attribute2: 103,
                        }),
                    ),
                ]),
            ).rejects.toThrow(
                new FailedPreconditionError(
                    transactionDirectlyUpdateCreateItemFailedPreconditionMessage,
                ),
            );

            await expect(
                RynamoTableSchema.executeTransaction(space.systemAction(), [
                    TestTable.transactionDirectlyUpdateItem({
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                        // @ts-expect-error: HACK
                        oldItem: {
                            partitionType: "Partition",
                            sortRangeType: "SortRange",
                            testPartitionKey: 4,
                            testSortKey: 5,
                            attribute1: 100,
                            attribute2: 103,
                        },
                    }),
                ]),
            ).rejects.toThrow(
                new FailedPreconditionError(
                    "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]",
                ),
            );

            await expect(
                RynamoTableSchema.executeTransaction(space.systemAction(), [
                    TestTable.transactionDirectlyUpdateItem({
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                        // @ts-expect-error: HACK
                        oldItem: {
                            partitionType: "Partition",
                            sortRangeType: "SortRange",
                            testPartitionKey: 4,
                            testSortKey: 5,
                            attribute1: 123456789,
                            attribute2: 103,
                        },
                    }),
                ]),
            ).rejects.toThrow(
                new FailedPreconditionError(
                    transactionDirectlyUpdateMovedIndexFailedPreconditionMessage,
                ),
            );

            await RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDirectlyUpdateItem({
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 100,
                    attribute2: 103,
                    // @ts-expect-error: HACK
                    oldItem: {
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 102,
                        attribute2: 103,
                    },
                }),
            ]);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
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
                        cursor: testIndexCursorForPartition4Sort5,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort3,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [
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
                                    cursor: testIndexCursorForPartition4Sort5,
                                },
                            ],
                        ]),
                    },
                ],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [
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

            expect(takeEventss().length).toEqual(4);
        } finally {
            import.meta.jest.useRealTimers();
        }
    });

    test("can delete an item with a property in an index\u2019s partition key that can be updated and a delete event will show up in the old query\u2019s backfill (with transactions)", async () => {
        import.meta.jest.useFakeTimers();

        try {
            const space = await TestSpace.create(context);

            const TestModelSchema = Schema.object({
                partitionKey: Schema.integer,
                sortKey: Schema.integer,
                attribute1: Schema.integer,
                attribute2: Schema.integer,
            });

            let eventss: Array<ReadonlyArray<RynamoEvent<SchemaType<typeof TestModelSchema>>>> = [];

            const takeEventss = () => {
                const currentEventss = eventss;
                eventss = [];
                return currentEventss;
            };

            const TestTable = RynamoTableSchema.new({
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
                broadcastEvents: async (context, events) => {
                    eventss.push(
                        await runAllPromises(events.map(({getEvent}) => getEvent(context))),
                    );
                },
            });

            let TestIndex;

            switch (indexKind) {
                case "eventual consistency join index": {
                    TestIndex = TestTable.addEventualConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "eventual consistency full index": {
                    TestIndex = TestTable.addExpensiveFullEventualConsistencyIndex({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                case "strong consistency join index": {
                    TestIndex = TestTable.addStrongConsistencyIndexWithQueryJoin({
                        name: "Index",
                        itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                        partitionKeyAttributes: {
                            attribute1: DynamoKeyAttributeSchema.integer,
                        },
                        sortKeyAttributes: {
                            attribute2: DynamoKeyAttributeSchema.integer,
                            testPartitionKey: DynamoKeyAttributeSchema.integer,
                            testSortKey: DynamoKeyAttributeSchema.integer,
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(indexKind);
            }

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

            const checkpoint = generateServerSynchronizationCheckpoint();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
                        key: "-7---------08F3--7---------1",
                        version: 1,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition4Sort5,
                        key: "-7---------38F3--7---------4",
                        version: 1,
                        model: {
                            partitionKey: 4,
                            sortKey: 5,
                            attribute1: 102,
                            attribute2: 103,
                        },
                    },
                    {
                        cursor: testIndexCursorForPartition1Sort3,
                        key: "-7---------08F3--7---------2",
                        version: 1,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            await expect(
                RynamoTableSchema.executeTransaction(space.systemAction(), [
                    TestTable.transactionDeleteItem({
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 100,
                        attribute2: 103,
                    }),
                ]),
            ).rejects.toThrow(new FailedPreconditionError(deleteItemFailedPreconditionMessage));

            await expect(
                RynamoTableSchema.executeTransaction(space.systemAction(), [
                    TestTable.transactionDeleteItem({
                        partitionType: "Partition",
                        sortRangeType: "SortRange",
                        testPartitionKey: 4,
                        testSortKey: 5,
                        attribute1: 123456789,
                        attribute2: 103,
                    }),
                ]),
            ).rejects.toThrow(new FailedPreconditionError(deleteItemFailedPreconditionMessage));

            await RynamoTableSchema.executeTransaction(space.systemAction(), [
                TestTable.transactionDeleteItem({
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 4,
                    testSortKey: 5,
                    attribute1: 102,
                    attribute2: 103,
                    updateLockVersion: 1,
                }),
            ]);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
                        key: "-7---------08F3--7---------1",
                        version: 1,
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
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort3,
                        key: "-7---------08F3--7---------2",
                        version: 1,
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
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [],
            });

            expect(
                await TestIndex.backfillRealtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 102},
                    checkpoint,
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                events: [
                    {
                        type: "DeleteItem",
                        item: {
                            key: "-7---------38F3--7---------4",
                            version: 2,
                        },
                        indexes: new Set(["Index"]),
                    },
                ],
            });

            expect(takeEventss().length).toEqual(4);
        } finally {
            import.meta.jest.useRealTimers();
        }
    });

    test("can read with strong consistency only from a strong consistency index", async () => {
        const space = await TestSpace.create(context);

        const TestModelSchema = Schema.object({
            partitionKey: Schema.integer,
            sortKey: Schema.integer,
            attribute1: Schema.integer,
            attribute2: Schema.integer,
        });

        const TestTable = RynamoTableSchema.new({
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
            broadcastEvents: async () => {},
        });

        let TestIndex;

        switch (indexKind) {
            case "eventual consistency join index": {
                TestIndex = TestTable.addEventualConsistencyIndexWithQueryJoin({
                    name: "Index",
                    itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                    partitionKeyAttributes: {
                        attribute1: DynamoKeyAttributeSchema.integer,
                    },
                    sortKeyAttributes: {
                        attribute2: DynamoKeyAttributeSchema.integer,
                    },
                });
                break;
            }
            case "eventual consistency full index": {
                TestIndex = TestTable.addExpensiveFullEventualConsistencyIndex({
                    name: "Index",
                    itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                    partitionKeyAttributes: {
                        attribute1: DynamoKeyAttributeSchema.integer,
                    },
                    sortKeyAttributes: {
                        attribute2: DynamoKeyAttributeSchema.integer,
                    },
                });
                break;
            }
            case "strong consistency join index": {
                TestIndex = TestTable.addStrongConsistencyIndexWithQueryJoin({
                    name: "Index",
                    itemTypes: [{partitionType: "Partition", sortRangeType: "SortRange"}],
                    partitionKeyAttributes: {
                        attribute1: DynamoKeyAttributeSchema.integer,
                    },
                    sortKeyAttributes: {
                        attribute2: DynamoKeyAttributeSchema.integer,
                        testPartitionKey: DynamoKeyAttributeSchema.integer,
                        testSortKey: DynamoKeyAttributeSchema.integer,
                    },
                });
                break;
            }
            default:
                throw exhaustive(indexKind);
        }

        finishInitializingDynamoTableSchemas();

        await TestTable.createItem(space.systemAction(), {
            partitionType: "Partition",
            sortRangeType: "SortRange",
            testPartitionKey: 1,
            testSortKey: 2,
            attribute1: 100,
            attribute2: 101,
        });

        if (indexKind === "strong consistency join index") {
            expect(
                await TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                    consistency: "Strong",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                        cursor: testIndexCursorForPartition1Sort2,
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
                await TestIndex.query(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                    consistency: "Strong",
                }),
            ).toEqual([
                {
                    partitionType: "Partition",
                    sortRangeType: "SortRange",
                    testPartitionKey: 1,
                    testSortKey: 2,
                    attribute1: 100,
                    attribute2: 101,
                },
            ]);
        } else {
            await expect(
                TestIndex.realtimeQuery(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                    consistency: "Strong",
                }),
            ).rejects.toThrow(new InternalError(eventualConsistencyAssertionMessage));

            await expect(
                TestIndex.query(space.systemAction(), {
                    partitionKey: {attribute1: 100},
                    limit: "All",
                    consistency: "Strong",
                }),
            ).rejects.toThrow(new InternalError(eventualConsistencyAssertionMessage));
        }
    });
});
