import {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaDescription,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {
    DynamoPartitionRangeDescription,
    DynamoPartitionRangeSchema,
    DynamoPartitionRangeSchemaConfig,
} from "~/server/dynamo/internal/dynamo-partition-range-schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {assert} from "~/shared/helpers/control/assert";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order-key";
import {quote} from "~/shared/helpers/string/quote";

export type DynamoPartitionSchemaConfig<
    PartitionKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>},
> = {
    readonly name: string;
    readonly keyAttributes: PartitionKeyAttributes;
};

export type DynamoPartitionDescription = {
    readonly name: string;
    readonly keyAttributeByKey: {readonly [key: string]: DynamoKeyAttributeSchemaDescription};
    readonly rangeByName: {readonly [name: string]: DynamoPartitionRangeDescription};
};

export class DynamoPartitionSchema<PartitionKeyAttributes extends {[key: string]: unknown}> {
    public readonly table: DynamoTableSchema;
    public readonly name: string;
    private readonly _lastDescription: DynamoPartitionDescription | null;
    private readonly _keyAttributeByKey: ReadonlyMap<string, DynamoKeyAttributeSchema<any>>;

    private readonly _rangeByName = new Map<
        string,
        DynamoPartitionRangeSchema<PartitionKeyAttributes, {[key: string]: unknown}>
    >();

    public static _addToTable<
        PartitionKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>},
    >(
        table: DynamoTableSchema,
        lastDescription: DynamoPartitionDescription | null,
        config: DynamoPartitionSchemaConfig<PartitionKeyAttributes>,
    ): DynamoPartitionSchema<{
        [Key in keyof PartitionKeyAttributes]: DynamoKeyAttributeSchemaType<
            PartitionKeyAttributes[Key]
        >;
    }> {
        return new DynamoPartitionSchema(table, lastDescription, config);
    }

    private constructor(
        table: DynamoTableSchema,
        lastDescription: DynamoPartitionDescription | null,
        config: DynamoPartitionSchemaConfig<{[key: string]: DynamoKeyAttributeSchema<any>}>,
    ) {
        this.table = table;
        this.name = config.name;
        this._lastDescription = lastDescription;
        this._keyAttributeByKey = new Map(Object.entries(config.keyAttributes));
    }

    public addRange<SortKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>}>(
        config: DynamoPartitionRangeSchemaConfig<SortKeyAttributes>,
    ): DynamoPartitionRangeSchema<
        PartitionKeyAttributes,
        {[Key in keyof SortKeyAttributes]: DynamoKeyAttributeSchemaType<SortKeyAttributes[Key]>}
    > {
        assert(!this.table.isFrozen());
        assert(!this._rangeByName.has(config.name));
        const range = DynamoPartitionRangeSchema._addToPartition(this, config);
        assert(config.name === range.name);
        this._rangeByName.set(range.name, range);
        return range;
    }

    private _rangeOrderKeyByName: ReadonlyMap<string, OrderKey> | null = null;

    private _getRangeOrderKeyByName(): ReadonlyMap<string, OrderKey> {
        assert(this.table.isFrozen());

        if (this._rangeOrderKeyByName) return this._rangeOrderKeyByName;

        const rangeOrderKeyByName = new Map<string, OrderKey>();
        let lastOrderKey: OrderKey | null = null;
        let rangeNamesWithoutOrderKey = [];

        for (const range of this._rangeByName.values()) {
            const rangeOrderKey = this._lastDescription?.rangeByName[range.name]?.orderKey;

            if (!rangeOrderKey) {
                rangeNamesWithoutOrderKey.push(range.name);
            } else {
                const newRangeOrderKeys = generateOrderKeysBetween(
                    lastOrderKey,
                    rangeOrderKey,
                    rangeNamesWithoutOrderKey.length,
                );

                for (let index = 0; index < rangeNamesWithoutOrderKey.length; index++) {
                    rangeOrderKeyByName.set(
                        rangeNamesWithoutOrderKey[index]!,
                        newRangeOrderKeys[index]!,
                    );
                }

                lastOrderKey = rangeOrderKey;
                rangeNamesWithoutOrderKey = [];
                rangeOrderKeyByName.set(range.name, rangeOrderKey);
            }
        }

        const newRangeOrderKeys = generateOrderKeysBetween(
            lastOrderKey,
            null,
            rangeNamesWithoutOrderKey.length,
        );

        for (let index = 0; index < rangeNamesWithoutOrderKey.length; index++) {
            rangeOrderKeyByName.set(rangeNamesWithoutOrderKey[index]!, newRangeOrderKeys[index]!);
        }

        this._rangeOrderKeyByName = rangeOrderKeyByName;
        return rangeOrderKeyByName;
    }

    private _getRangeOrderKey(
        range: DynamoPartitionRangeSchema<PartitionKeyAttributes, {[key: string]: unknown}>,
    ): OrderKey {
        assert(this.table.isFrozen());
        assert(range.partition === this);
        const rangeOrderKeyByName = this._getRangeOrderKeyByName();
        const rangeOrderKey = rangeOrderKeyByName.get(range.name);
        assert(rangeOrderKey);
        return rangeOrderKey;
    }

    public getDescription(): DynamoPartitionDescription {
        assert(this.table.isFrozen());

        return {
            name: this.name,
            keyAttributeByKey: Object.fromEntries(
                Array.from(this._keyAttributeByKey, ([key, keyAttribute]) => [
                    key,
                    keyAttribute.getDescription(),
                ]),
            ),
            rangeByName: Object.fromEntries(
                Array.from(this._rangeByName.values(), range => [
                    range.name,
                    range.getDescription(this._getRangeOrderKey(range)),
                ]),
            ),
        };
    }

    public checkAgainstDescription(description: DynamoPartitionDescription) {
        assert(this.table.isFrozen());

        if (this.name !== description.name)
            throw new Error(
                quote`Partition name mismatch, the name in the database is ${description.name} but the name in the schema is ${this.name}`,
            );

        const keyAttributeDescriptions = Object.values(description.keyAttributeByKey);
        const keyAttributes = Array.from(this._keyAttributeByKey.values());

        if (keyAttributeDescriptions.length !== keyAttributes.length)
            throw new Error(
                quote`Partition ${this.name} has ${keyAttributeDescriptions.length} key attribute(s) in the database and ${keyAttributes.length} key attribute(s) in the schema`,
            );

        for (let index = 0; index < keyAttributes.length; index++) {
            keyAttributes[index]!.checkAgainstDescription(keyAttributeDescriptions[index]!);
        }

        const rangeNames = new Set(Object.keys(description.rangeByName));
        let lastRangeOrderKey: OrderKey | null = null;

        for (const range of this._rangeByName.values()) {
            if (!rangeNames.delete(range.name))
                throw new Error(
                    quote`Range ${range.name} exists in the schema but not in the database`,
                );

            const rangeDescription = description.rangeByName[range.name]!;
            const rangeOrderKey = this._getRangeOrderKey(range);

            if (lastRangeOrderKey !== null) {
                if (lastRangeOrderKey === rangeOrderKey)
                    throw new Error(
                        quote`Duplicate range order key found in schema for range ${range.name}`,
                    );

                // Make sure our ranges are defined in the correct order. If this error is
                // firing, did you change the order of your `partitionSchema.addRange()` calls?
                if (lastRangeOrderKey > rangeOrderKey)
                    throw new Error(
                        quote`Mispositioned range order key found in schema for range ${range.name}`,
                    );
            }

            lastRangeOrderKey = rangeOrderKey;

            if (rangeOrderKey !== rangeDescription.orderKey)
                throw new Error(
                    quote`Range order key mismatch, the order key in the database is ${rangeDescription.orderKey} but the order key in the schema is ${rangeOrderKey}`,
                );

            range.checkAgainstDescription(rangeDescription);
        }

        for (const rangeName of rangeNames)
            throw new Error(quote`Range ${rangeName} exists in the database but not in the schema`);
    }
}
