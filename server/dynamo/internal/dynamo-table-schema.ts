import * as cdk from "aws-cdk-lib";
import {paramCase} from "change-case";
import {Construct} from "constructs";
import fs from "fs-extra";
import isCi from "is-ci";
import path from "path";
import {
    DynamoClient,
    DynamoReadConsistency,
    DynamoTransactionEntry,
} from "~/server/dynamo/internal/dynamo-client";
import {
    DynamoCondition,
    DynamoConditionExpression,
    DynamoConditionExpressionCompilationContext,
} from "~/server/dynamo/internal/dynamo-condition";
import {dynamoKeySeparator} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableSchemaTypes} from "~/server/dynamo/internal/types/dynamo-table-schema-types";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {checkSchemaDescriptionBackwardsCompatibility} from "~/server/schema/check-schema-description-backwards-compatibility";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {mapObjectValues} from "~/shared/helpers/object/map-object-values";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order-key";
import {defaultCompareStrings} from "~/shared/helpers/string/default-compare-strings";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge-object-intersection";
import {SchemaSerializedValue} from "~/shared/schema/schema";

// TODO(calebmer): Documentation!!!

/**
 * When schema evolution is enabled, the schema in code may be different from
 * the last schema used to write to the database.
 *
 * We will validate that the schema in code is backwards compatible with the
 * last schema used to write to the database. Then we will record the schema in
 * code as the schema to which data in the database should adhere.
 */
const isSchemaEvolutionEnabled =
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") && !isCi;

const dynamoGeneratedDirectoryPath = path.join(
    repoDirectoryPath,
    "server/dynamo/internal/generated",
);

export type DynamoTableSchemaGetTypes<Schema extends DynamoTableSchema<any>> =
    Schema extends DynamoTableSchema<infer Types> ? Types : never;

export class DynamoTableSchema<
    Types extends DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>,
> {
    private readonly _config: DynamoTableSchemaTypes.ConfigBase;
    private readonly _descriptionPath: string;
    private readonly _description: DynamoTableSchemaTypes.Description;
    private _hasCommitDescription = false;

    public static new<Config extends DynamoTableSchemaTypes.ConfigBase>(
        config: Config,
    ): DynamoTableSchema<DynamoTableSchemaTypes.Types<Config>> {
        return new DynamoTableSchema(config);
    }

    private constructor(config: DynamoTableSchemaTypes.ConfigBase) {
        this._config = config;

        const {descriptionPath, description} = getAndCheckDynamoTableSchemaDescriptions(
            this._config,
        );

        this._descriptionPath = descriptionPath;
        this._description = description;

        assert(!allConstructedDynamoTableSchemas.has(this._config.name));
        allConstructedDynamoTableSchemas.set(this._config.name, this);
    }

    public addAwsResources(scope: Construct) {
        new cdk.aws_dynamodb.Table(scope, `${this._config.name}Table`, {
            tableName: this._config.name,
            partitionKey: {
                name: "partitionKey",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: "sortKey",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },

            // If we have predictable traffic patterns then provisioned billing mode may be
            // cheaper. If we're consistently utilizing 100% provisioned capacity (very
            // unlikely) then provisioned billing mode is ~7x cheaper.
            //
            // Reconsider billing mode when we have traffic.
            //
            // https://www.serverless.com/blog/dynamodb-on-demand-serverless
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
        });
    }

    private _serializeKey(key: Types["Key"]): {
        partitionKey: string;
        sortKey: string;
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
        const partitionConfig = this._config.partitions[key.partitionType];
        const partitionDescription = this._description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRanges[key.sortRangeType];
        const sortRangeDescription = partitionDescription.sortRangeByType[key.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        const partitionKeyEntries = [key.partitionType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            partitionKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
        }

        const sortKeyEntries = [sortRangeDescription.orderKey, key.partitionSortType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            partitionKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
        }

        const partitionKey = partitionKeyEntries.join(dynamoKeySeparator);

        const sortKey = sortKeyEntries.join(dynamoKeySeparator);

        return {
            partitionKey,
            sortKey,
            attributesSchema: sortRangeConfig.attributes,
        };
    }

    public async getItem<Key extends Types["Key"]>(
        client: DynamoClient,
        key: Key,
        {consistency}: {consistency?: DynamoReadConsistency} = {},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        const serializedItem = await client.getItem({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            consistency,
        });

        const item: any = {...key};
        attributesSchema.deserializeInto(serializedItem, item);

        return item;
    }

    public async putItem<Item extends Types["Item"]>(
        client: DynamoClient,
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): Promise<void> {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(item as Types["Key"]);

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        if (condition === undefined) {
            return client.putItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                item: serializedItem,
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return client.putItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    public deleteItem<Key extends Types["Key"]>(
        client: DynamoClient,
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): Promise<void> {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        if (condition === undefined) {
            return client.deleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return client.deleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    public transactionPutItem<Item extends Types["Item"]>(
        client: DynamoClient,
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): DynamoTransactionEntry {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(item as Types["Key"]);

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        if (condition === undefined) {
            return client.transactionPutItem({
                tableName: this._config.name,
                item: serializedItem,
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return client.transactionPutItem({
                tableName: this._config.name,
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    public transactionDeleteItem<Key extends Types["Key"]>(
        client: DynamoClient,
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): DynamoTransactionEntry {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        if (condition === undefined) {
            return client.transactionDeleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return client.transactionDeleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    public transactionConditionCheck<Key extends Types["Key"]>(
        client: DynamoClient,
        key: Key,
        condition: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
        const conditionExpression = DynamoConditionExpression.from(condition);
        const {string: conditionExpressionString} = conditionExpression.compile(
            attributesSchema,
            conditionCompilationContext,
        );

        return client.transactionConditionCheck({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            conditionExpression: conditionExpressionString,
            expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
        });
    }

    public async query<
        PartitionKey extends Types["PartitionKey"],
        StartKey extends Types["Key"] & PartitionKey,
        EndKey extends Types["Key"] & PartitionKey,
    >({
        startKey,
        endKey,
    }: {
        startKey: StartKey;
        endKey: EndKey;
    }): Promise<
        Array<
            MergeObjectIntersection<
                Types["Item"] &
                    PartitionKey & {
                        readonly partitionSortType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartKey["partitionSortType"]][EndKey["partitionSortType"]];
                    }
            >
        >
    > {
        // TODO(calebmer): Implement!!
        return [];
    }

    /**
     * Before we start writing data to DynamoDB, we should commit our new
     * description. In case newly written data uses the new schema.
     *
     * We wait until the first write to commit our description so if the user is
     * iterating on code in their editor we don't lock their new schema in until
     * they start writing data.
     *
     * Synchronous because we want to call this in our transaction functions as
     * well which return an object synchronously.
     */
    private _commitDescriptionOnFirstWrite() {
        if (!isSchemaEvolutionEnabled) return;

        if (this._hasCommitDescription) return;
        this._hasCommitDescription = true;

        fs.writeFileSync(this._descriptionPath, JSON.stringify(this._description, null, 2));
    }
}

const allConstructedDynamoTableSchemas = new Map<
    string,
    DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
>();

/**
 * Get all `DynamoTableSchema`s that have been constructed so far.
 *
 * They will be sorted by name so the order is deterministic.
 */
export function getAllConstructedDynamoTableSchemas(): Array<
    DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
> {
    return Array.from(allConstructedDynamoTableSchemas)
        .sort(([name1], [name2]) => defaultCompareStrings(name1, name2))
        .map(([, schema]) => schema);
}

function getAndCheckDynamoTableSchemaDescriptions(config: DynamoTableSchemaTypes.ConfigBase): {
    descriptionPath: string;
    lastDescription: DynamoTableSchemaTypes.Description | null;
    description: DynamoTableSchemaTypes.Description;
} {
    const descriptionPath = path.join(
        dynamoGeneratedDirectoryPath,
        `dynamo-${paramCase(config.name)}-table-schema.json`,
    );

    const lastDescription: DynamoTableSchemaTypes.Description = fs.existsSync(descriptionPath)
        ? JSON.parse(fs.readFileSync(descriptionPath, "utf8"))
        : null;

    const description: DynamoTableSchemaTypes.Description = {
        name: config.name,
        partitionByType: mapObjectValues(
            config.partitions,
            (partitionConfig, partitionType): DynamoTableSchemaTypes.Partition.Description => {
                // Iterate through all our sort ranges, in order, finding contiguous subsets of
                // the list which do not have an `OrderKey` in the last description. For these
                // sort ranges generate new `OrderKey`s for our new description.
                const sortRangeOrderKeyByType = new Map<string, OrderKey>();
                let lastExistingSortRangeOrderKey: OrderKey | null = null;
                let sortRangeTypesWithoutExistingOrderKey = [];

                for (const sortRangeType of Object.keys(partitionConfig.sortRanges)) {
                    const existingSortRangeOrderKey =
                        lastDescription?.partitionByType[partitionType]?.sortRangeByType[
                            sortRangeType
                        ]?.orderKey;

                    if (!existingSortRangeOrderKey) {
                        sortRangeTypesWithoutExistingOrderKey.push(sortRangeType);
                    } else {
                        // The order of `sortRanges` in our config object matters! It must be the same
                        // as the order key order. Throw an error if we detect the developer may have
                        // moved things around. That's a backwards incompatible change.
                        if (
                            lastExistingSortRangeOrderKey !== null &&
                            lastExistingSortRangeOrderKey >= existingSortRangeOrderKey
                        ) {
                            throw new Error(
                                `Order key for sort range \`${sortRangeType}\` is less than a previous sort range order key. Did you reorder your sort range object?`,
                            );
                        }

                        const newSortRangeOrderKeys = generateOrderKeysBetween(
                            lastExistingSortRangeOrderKey,
                            existingSortRangeOrderKey,
                            sortRangeTypesWithoutExistingOrderKey.length,
                        );

                        for (
                            let index = 0;
                            index < sortRangeTypesWithoutExistingOrderKey.length;
                            index++
                        ) {
                            sortRangeOrderKeyByType.set(
                                sortRangeTypesWithoutExistingOrderKey[index]!,
                                newSortRangeOrderKeys[index]!,
                            );
                        }

                        lastExistingSortRangeOrderKey = existingSortRangeOrderKey;
                        sortRangeTypesWithoutExistingOrderKey = [];
                        sortRangeOrderKeyByType.set(sortRangeType, existingSortRangeOrderKey);
                    }
                }

                const newSortRangeOrderKeys = generateOrderKeysBetween(
                    lastExistingSortRangeOrderKey,
                    null,
                    sortRangeTypesWithoutExistingOrderKey.length,
                );

                for (let index = 0; index < sortRangeTypesWithoutExistingOrderKey.length; index++) {
                    sortRangeOrderKeyByType.set(
                        sortRangeTypesWithoutExistingOrderKey[index]!,
                        newSortRangeOrderKeys[index]!,
                    );
                }

                return {
                    partitionKeyAttributeByKey: mapObjectValues(
                        partitionConfig.partitionKeyAttributes,
                        keyAttribute => keyAttribute.description,
                    ),
                    sortRangeByType: mapObjectValues(
                        partitionConfig.sortRanges,
                        (
                            sortRangeConfig,
                            sortRangeType,
                        ): DynamoTableSchemaTypes.SortRange.Description => ({
                            orderKey: sortRangeOrderKeyByType.get(sortRangeType)!,
                            sortKeyAttributeByKey: mapObjectValues(
                                sortRangeConfig.sortKeyAttributes,
                                keyAttribute => keyAttribute.description,
                            ),
                            attributesSchema: sortRangeConfig.attributes.description,
                        }),
                    ),
                };
            },
        ),
    };

    // If we have a description saved, then verify our new description is backwards
    // compatible with the old description. We will save our new description the
    // first time an item is written to this table.
    if (lastDescription !== null) {
        checkDynamoTableSchemaDescriptionBackwardsCompatibility(lastDescription, description);

        // We only allow schema evolution in development and test environments. If we
        // are running in production then our schema's description in code must exactly
        // match the generated schema description. We can check exact equality by
        // running our backwards compatibility check in the other direction.
        if (!isSchemaEvolutionEnabled) {
            checkDynamoTableSchemaDescriptionBackwardsCompatibility(description, lastDescription);
        }
    }

    return {
        descriptionPath,
        lastDescription,
        description,
    };
}

function checkDynamoTableSchemaDescriptionBackwardsCompatibility(
    lastDescription: DynamoTableSchemaTypes.Description,
    nextDescription: DynamoTableSchemaTypes.Description,
): void {
    if (lastDescription.name !== nextDescription.name)
        throw new Error(
            `Table name \`${lastDescription.name}\` is not the same as \`${nextDescription.name}\``,
        );

    const missingPartitionTypes = new Set(Object.keys(lastDescription.partitionByType));

    for (const [partitionType, nextPartitionSchemaDescription] of Object.entries(
        nextDescription.partitionByType,
    )) {
        if (missingPartitionTypes.delete(partitionType)) {
            checkDynamoTablePartitionSchemaDescriptionBackwardsCompatibility(
                partitionType,
                lastDescription.partitionByType[partitionType]!,
                nextPartitionSchemaDescription,
            );
        }
    }

    for (const partitionName of missingPartitionTypes)
        throw new Error(`Partition \`${partitionName}\` is missing`);
}

function checkDynamoTablePartitionSchemaDescriptionBackwardsCompatibility(
    type: string,
    lastDescription: DynamoTableSchemaTypes.Partition.Description,
    nextDescription: DynamoTableSchemaTypes.Partition.Description,
): void {
    const lastKeyAttributeDescriptions = Object.values(lastDescription.partitionKeyAttributeByKey);
    const nextKeyAttributeDescriptions = Object.values(nextDescription.partitionKeyAttributeByKey);

    // Require partition key to always be exactly what was initially configured. No
    // migrations!
    if (!isDeepEqual(lastKeyAttributeDescriptions, nextKeyAttributeDescriptions))
        throw new Error(`Incompatible partition key for partition \`${type}\``);

    const missingSortRangeTypes = new Set(Object.keys(lastDescription.sortRangeByType));

    for (const [sortRangeType, nextSortRangeSchemaDescription] of Object.entries(
        nextDescription.sortRangeByType,
    )) {
        if (missingSortRangeTypes.delete(sortRangeType)) {
            checkDynamoTableSortRangeSchemaDescriptionBackwardsCompatibility(
                sortRangeType,
                lastDescription.sortRangeByType[sortRangeType]!,
                nextSortRangeSchemaDescription,
            );
        }
    }

    for (const sortRange of missingSortRangeTypes)
        throw new Error(`Sort range \`${sortRange}\` is missing`);
}

function checkDynamoTableSortRangeSchemaDescriptionBackwardsCompatibility(
    type: string,
    lastDescription: DynamoTableSchemaTypes.SortRange.Description,
    nextDescription: DynamoTableSchemaTypes.SortRange.Description,
): void {
    const lastKeyAttributeDescriptions = Object.values(lastDescription.sortKeyAttributeByKey);
    const nextKeyAttributeDescriptions = Object.values(nextDescription.sortKeyAttributeByKey);

    // Require partition key to always be exactly what was initially configured. No
    // migrations!
    if (!isDeepEqual(lastKeyAttributeDescriptions, nextKeyAttributeDescriptions))
        throw new Error(`Incompatible sort key for sort range \`${type}\``);

    if (lastDescription.orderKey !== nextDescription.orderKey)
        throw new Error(`Incompatible order key for sort range \`${type}\``);

    checkSchemaDescriptionBackwardsCompatibility(
        lastDescription.attributesSchema,
        nextDescription.attributesSchema,
    );
}
