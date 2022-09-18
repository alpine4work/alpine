import type {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaDescription,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import type {OrderKey} from "~/shared/helpers/sort/order-key";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge-object-intersection";
import {UnionToTuple} from "~/shared/helpers/types/union-to-tuple";
import type {ObjectSchema, SchemaType} from "~/shared/schema/schema";
import {SchemaDescription} from "~/shared/schema/types/schema-description-types";

// TODO(calebmer): Documentation!!!
export namespace DynamoTableSchemaTypes {
    export type ConfigBase = {
        readonly name: string;
        readonly partitions: {
            readonly [type: string]: Partition.ConfigBase;
        };
    };

    export type Description = {
        readonly name: string;
        readonly partitionByType: {
            readonly [type: string]: Partition.Description;
        };
    };

    export type Types<Config extends ConfigBase> = {
        PartitionKey: PartitionKeyType<Config>;
        Key: KeyType<Config>;
        Item: ItemType<Config>;
        QueryKeyMap: QueryKeyMapType<Config>;
    };

    export type PartitionKeyType<Config extends ConfigBase> = {
        [Type in keyof Config["partitions"]]: MergeObjectIntersection<
            {
                readonly partitionType: Type;
            } & KeyAttributes.Type<Config["partitions"][Type]["partitionKeyAttributes"]>
        >;
    }[keyof Config["partitions"]];

    export type KeyType<Config extends ConfigBase> = {
        [Type in keyof Config["partitions"]]: MergeObjectIntersection<
            {
                readonly partitionType: Type;
            } & KeyAttributes.Type<Config["partitions"][Type]["partitionKeyAttributes"]> &
                Partition.KeyType<Config["partitions"][Type]>
        >;
    }[keyof Config["partitions"]];

    export type ItemType<Config extends ConfigBase> = {
        [Type in keyof Config["partitions"]]: MergeObjectIntersection<
            {
                readonly partitionType: Type;
            } & KeyAttributes.Type<Config["partitions"][Type]["partitionKeyAttributes"]> &
                Partition.ItemType<Config["partitions"][Type]>
        >;
    }[keyof Config["partitions"]];

    export type QueryKeyMapType<Config extends ConfigBase> = {
        [PartitionType in keyof Config["partitions"]]: Partition.QueryKeyMapType<
            Config["partitions"][PartitionType],
            UnionToTuple<keyof Config["partitions"][PartitionType]["sortRanges"] & string>
        >;
    };

    export namespace KeyAttributes {
        export type ConfigBase = {
            readonly [key: string]: DynamoKeyAttributeSchema<any>;
        };

        export type Type<Config extends ConfigBase> = {
            readonly [Key in keyof Config]: DynamoKeyAttributeSchemaType<Config[Key]>;
        };
    }

    export namespace Partition {
        export type ConfigBase = {
            readonly partitionKeyAttributes: KeyAttributes.ConfigBase;
            readonly sortRanges: {
                readonly [type: string]: SortRange.ConfigBase;
            };
        };

        export type Description = {
            readonly partitionKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
            readonly sortRangeByType: {
                readonly [type: string]: SortRange.Description;
            };
        };

        export type KeyType<Config extends ConfigBase> = KeyAttributes.Type<
            Config["partitionKeyAttributes"]
        > &
            {
                [Type in keyof Config["sortRanges"]]: {
                    readonly sortRangeType: Type;
                } & SortRange.KeyType<Config["sortRanges"][Type]>;
            }[keyof Config["sortRanges"]];

        export type ItemType<Config extends ConfigBase> = KeyAttributes.Type<
            Config["partitionKeyAttributes"]
        > &
            {
                [Type in keyof Config["sortRanges"]]: {
                    readonly sortRangeType: Type;
                } & SortRange.ItemType<Config["sortRanges"][Type]>;
            }[keyof Config["sortRanges"]];

        export type QueryKeyMapType<Config extends ConfigBase, Tuple extends Array<unknown>> = {
            [StartPartitionSortType in keyof Config["sortRanges"] & string]: {
                [EndPartitionSortType in keyof Config["sortRanges"] &
                    string]: TupleDropBeforeAndTakeUntil<
                    Tuple,
                    StartPartitionSortType,
                    EndPartitionSortType
                >[number];
            };
        };

        type TupleDropBeforeAndTakeUntil<
            Tuple extends Array<any>,
            DropBefore extends any,
            TakeUntil extends any,
        > = Tuple extends [DropBefore, ...any]
            ? TupleTakeUntil<Tuple, TakeUntil, []>
            : Tuple extends [any, ...infer Tail]
            ? TupleDropBeforeAndTakeUntil<Tail, DropBefore, TakeUntil>
            : Tuple extends []
            ? // TODO(calebmer): Comment how this is intentional
              never
            : never;

        type TupleTakeUntil<
            Tuple extends Array<any>,
            TakeUntil extends any,
            AccTuple extends Array<any>,
        > = Tuple extends [TakeUntil, ...any]
            ? [TakeUntil, ...AccTuple]
            : Tuple extends [infer Head, ...infer Tail]
            ? // TODO(calebmer): Comment on how we use tail recursion here because order doesn't matter?
              // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5/#tailrec-conditional
              TupleTakeUntil<Tail, TakeUntil, [Head, ...AccTuple]>
            : Tuple extends []
            ? // TODO(calebmer): Comment how this is intentional
              never
            : never;
    }

    export namespace SortRange {
        export type ConfigBase = {
            readonly sortKeyAttributes: KeyAttributes.ConfigBase;
            readonly attributes: ObjectSchema<any>;
        };

        export type Description = {
            readonly orderKey: OrderKey;
            readonly sortKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
            readonly attributesSchema: SchemaDescription;
        };

        export type KeyType<Config extends ConfigBase> = KeyAttributes.Type<
            Config["sortKeyAttributes"]
        >;

        export type ItemType<Config extends ConfigBase> = KeyAttributes.Type<
            Config["sortKeyAttributes"]
        > &
            SchemaType<Config["attributes"]>;
    }
}
