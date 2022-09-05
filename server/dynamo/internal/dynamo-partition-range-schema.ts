import {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaDescription,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoPartitionSchema} from "~/server/dynamo/internal/dynamo-partition-schema";
import {OrderKey} from "~/shared/helpers/sort/order-key";
import {quote} from "~/shared/helpers/string/quote";

export type DynamoPartitionRangeSchemaConfig<
    SortKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>},
> = {
    readonly name: string;
    readonly keyAttributes: SortKeyAttributes;
};

export type DynamoPartitionRangeDescription = {
    readonly name: string;
    readonly orderKey: OrderKey;
    readonly keyAttributeByKey: {readonly [key: string]: DynamoKeyAttributeSchemaDescription};
};

export class DynamoPartitionRangeSchema<
    PartitionKeyAttributes extends {[key: string]: unknown},
    SortKeyAttributes extends {[key: string]: unknown},
> {
    public readonly partition: DynamoPartitionSchema<PartitionKeyAttributes>;
    public readonly name: string;
    private readonly _keyAttributeByKey: ReadonlyMap<string, DynamoKeyAttributeSchema<any>>;

    public static _addToPartition<
        PartitionKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>},
        SortKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>},
    >(
        partition: DynamoPartitionSchema<PartitionKeyAttributes>,
        config: DynamoPartitionRangeSchemaConfig<SortKeyAttributes>,
    ): DynamoPartitionRangeSchema<
        PartitionKeyAttributes,
        {[Key in keyof SortKeyAttributes]: DynamoKeyAttributeSchemaType<SortKeyAttributes[Key]>}
    > {
        return new DynamoPartitionRangeSchema(partition, config);
    }

    private constructor(
        partition: DynamoPartitionSchema<PartitionKeyAttributes>,
        config: DynamoPartitionRangeSchemaConfig<{
            [key: string]: DynamoKeyAttributeSchema<any>;
        }>,
    ) {
        this.partition = partition;
        this.name = config.name;
        this._keyAttributeByKey = new Map(Object.entries(config.keyAttributes));
    }

    // The range order key is managed by our parent partition object.
    public getDescription(orderKey: OrderKey): DynamoPartitionRangeDescription {
        return {
            name: this.name,
            orderKey,
            keyAttributeByKey: Object.fromEntries(
                Array.from(this._keyAttributeByKey, ([key, keyAttribute]) => [
                    key,
                    keyAttribute.getDescription(),
                ]),
            ),
        };
    }

    public checkAgainstDescription(description: DynamoPartitionRangeDescription) {
        if (this.name !== description.name)
            throw new Error(
                quote`Partition range name mismatch, the name in the database is ${description.name} but the name in the schema is ${this.name}`,
            );

        const keyAttributeDescriptions = Object.values(description.keyAttributeByKey);
        const keyAttributes = Array.from(this._keyAttributeByKey.values());

        if (keyAttributeDescriptions.length !== keyAttributes.length)
            throw new Error(
                quote`Partition range ${this.name} has ${keyAttributeDescriptions.length} key attribute(s) in the database and ${keyAttributes.length} key attribute(s) in the schema`,
            );

        for (let index = 0; index < keyAttributes.length; index++) {
            keyAttributes[index]!.checkAgainstDescription(keyAttributeDescriptions[index]!);
        }
    }
}
