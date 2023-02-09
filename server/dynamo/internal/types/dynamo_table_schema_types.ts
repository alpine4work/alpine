import type {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaDescription,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import type {OrderKey} from "~/shared/helpers/sort/order_key";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {UnionToTuple} from "~/shared/helpers/types/union_to_tuple";
import type {ObjectSchema, SchemaType} from "~/shared/schema/schema";
import {SchemaSerializedValueDescription} from "~/shared/schema/types/schema_description_types";

/**
 * Types for the `DynamoTableSchema` file. These types get a little complicated. So
 * we put them in a separate file and organize them with `namespace`s. `namespace`s
 * help clearly show the hierarchy of types.
 *
 * ### Concepts
 *
 * A table is comprised of one or more **partitions**. Each type of partition
 * has its own partition key.
 *
 * A partition is comprised of one or more **sort ranges**. Each type of sort
 * range has its own sort key.
 *
 * The partition key and sort key together make up a key for a single item in
 * the table.
 *
 * Partitions are ordered by their sort key. So the data within sort ranges are
 * stored physically next to each other! `DynamoKeyAttributeSchema` is
 * responsible for determining the order of keys.
 *
 * Partitions are not ordered relative to each other.
 *
 * This means it is efficient to query a range of data within a partition since
 * it lives next to each other. It is impossible to query a range of partitions
 * since while data within a partition is ordered, partitions are not ordered
 * relative to each other.
 */
export namespace DynamoTableSchemaTypes {
    /**
     * The configuration object provided by a developer when constructing a
     * `DynamoTableSchema`.
     *
     * We use the "base" naming convention because this type is used as an upper
     * bound of type parameters. Like in
     * `new<Config extends ConfigBase>(config: Config): Types<Config>`.
     * Instantiations of this type are much more interesting.
     *
     * Because this type is used as an upper bound for type parameters, it's fine
     * to use `any` within the type.
     *
     * Most of the types in this file "compute" some other type based on a
     * config type.
     */
    export type ConfigBase = {
        readonly name: string;
        readonly partitions: {
            readonly [type: string]: Partition.ConfigBase;
        };
    };

    /**
     * The description object is generated from a `DynamoTableSchema` and saved to
     * a JSON file. See the documentation comments on
     * `DynamoTableSchema._description` and `DynamoTableSchema._config` for what
     * makes a description and config different.
     *
     * The short version is a description must be JSON serializable where as a
     * config doesn't need to be. Also descriptions contain `OrderKey`s for sort
     * ranges since those are generated and not configured by a developer.
     */
    export type Description = {
        readonly name: string;
        readonly partitionByType: {
            readonly [type: string]: Partition.Description;
        };
    };

    /**
     * Types used by a `DynamoTableSchema`.
     *
     * We put them all together in an object as an optimization so TypeScript only
     * computes them once since some of these types can be expensive to compute
     * (looking at you `QueryKeyMap`).
     *
     * See the documentation on each type (e.g. `PartitionKeyType`) for what its
     * purpose is.
     */
    export type Types<Config extends ConfigBase> = {
        PartitionKey: PartitionKeyType<Config>;
        SortKeyMap: SortKeyMapType<Config>;
        Key: KeyType<Config>;
        Item: ItemType<Config>;
        QueryKeyMap: QueryKeyMapType<Config>;
    };

    /**
     * The type of a partition key for our table.
     *
     * A table could have multiple types of partitions, in this case the type is a
     * union of they key type for all partitions.
     *
     * You can use `partitionType` to narrow down to an individual partition type.
     *
     * Attributes come from `partitionKeyAttributes`.
     *
     * Example:
     *
     * ```ts
     * type PartitionKey =
     *     | {partitionType: "A", a: number}
     *     | {partitionType: "B", b: number};
     * ```
     */
    export type PartitionKeyType<Config extends ConfigBase> = {
        [Type in keyof Config["partitions"]]: MergeObjectIntersection<
            {
                readonly partitionType: Type;
            } & KeyAttributes.Type<Config["partitions"][Type]["partitionKeyAttributes"]>
        >;
    }[keyof Config["partitions"]];

    /**
     * A map of partition type to the sort key type union for that partition.
     */
    export type SortKeyMapType<Config extends ConfigBase> = {
        [PartitionType in keyof Config["partitions"] & string]: Partition.SortKeyType<
            Config["partitions"][PartitionType]
        >;
    };

    /**
     * The type of key for our type. A key identifies an item in the table.
     *
     * A `Key` is also a valid `PartitionKey`.
     *
     * There is a different key type for every sort range in our table. This type
     * is a union of all key types for all sort ranges.
     *
     * You can use `partitionType` to narrow down to an individual partition type
     * and then `sortRangeType` to narrow down to an individual sort range within
     * that partition.
     *
     * Attributes come from `partitionKeyAttributes` and `sortKeyAttributes`.
     *
     * Example:
     *
     * ```ts
     * type Key =
     *     | {partitionType: "A", a: number, sortRangeType: "X", x: number}
     *     | {partitionType: "A", a: number, sortRangeType: "Y", y: number}
     *
     *     | {partitionType: "B", b: number, sortRangeType: "X", x: number}
     *     | {partitionType: "B", b: number, sortRangeType: "Y", y: number}
     *     | {partitionType: "B", b: number, sortRangeType: "Z", z: number};
     * ```
     */
    export type KeyType<Config extends ConfigBase> = {
        [Type in keyof Config["partitions"]]: MergeObjectIntersection<
            {
                readonly partitionType: Type;
            } & KeyAttributes.Type<Config["partitions"][Type]["partitionKeyAttributes"]> &
                Partition.KeyType<Config["partitions"][Type]>
        >;
    }[keyof Config["partitions"]];

    /**
     * The type of an item in our table.
     *
     * An `Item` is also a valid `Key` since the `Item` contains the `Key` which
     * identifies it.
     *
     * Each sort range stores different item data. This type is a union of all sort
     * range item types.
     *
     * You can use `partitionType` to narrow down to an individual partition type
     * and then `sortRangeType` to narrow down to an individual sort range within
     * that partition.
     */
    export type ItemType<Config extends ConfigBase> = {
        [Type in keyof Config["partitions"]]: MergeObjectIntersection<
            {
                readonly partitionType: Type;
            } & KeyAttributes.Type<Config["partitions"][Type]["partitionKeyAttributes"]> &
                Partition.ItemType<Config["partitions"][Type]> &
                ItemSharedAttributes
        >;
    }[keyof Config["partitions"]];

    /**
     * Internal properties shared across all items.
     */
    export type ItemSharedAttributes = {
        /**
         * A version number we use for implementing [optimistic locking][1] in the
         * `DynamoTableSchema.update()` function. If this property is not set it means
         * we have not yet called `DynamoTableSchema.update()` on this item.
         *
         * If the property does not exist, it is the same as if the value is 0. We
         * don't allow explicitly setting to 0, though, so that to test for version
         * 0 we only test for whether the property exists or not.
         *
         * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
         */
        readonly updateLockVersion?: number;
    };

    /**
     * A map we use for determining the return type of the `query()` function.
     *
     * It is a map of partition types to sort range types to sort range types
     * (again) to a tuple of sort range types.
     *
     * The first sort range type is the "start" sort range type. Or the sort range
     * type of the start key in a query. The second sort range type is the "end"
     * sort range type. Or the sort range type of the end key in a query.
     *
     * The tuple of sort range types represents all sort ranges between the start
     * sort range type and the end sort range type.
     *
     * So by doing `QueryKeyMap[PartitionType][StartSortRangeType][EndSortRangeType]`
     * you will get a tuple of sort range types between start and end. The
     * `query()` function returns an item type that only includes items from those
     * sort ranges.
     */
    export type QueryKeyMapType<Config extends ConfigBase> = {
        [PartitionType in keyof Config["partitions"]]: Partition.QueryKeyMapType<
            Config["partitions"][PartitionType],
            UnionToTuple<keyof Config["partitions"][PartitionType]["sortRanges"] & string>
        >;
    };

    /**
     * Types shared by both `partitionKeyAttributes` and `sortKeyAttributes`.
     */
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

        export type SortKeyType<Config extends ConfigBase> = {
            [Type in keyof Config["sortRanges"] & string]: {
                readonly sortRangeType: Type;
            } & SortRange.KeyType<Config["sortRanges"][Type]>;
        }[keyof Config["sortRanges"] & string];

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

        /**
         * Take a `Tuple` and return values between `DropBefore` and `TakeUntil`.
         *
         * So `TakeDropBeforeAndTakeUntil<["a", "b", "c", "d"], "b", "d">` is the
         * same as `["b", "c", "d"]`.
         */
        export type TupleDropBeforeAndTakeUntil<
            Tuple extends Array<any>,
            DropBefore extends any,
            TakeUntil extends any,
        > = Tuple extends [DropBefore, ...any]
            ? TupleTakeUntil<Tuple, TakeUntil, []>
            : Tuple extends [any, ...infer Tail]
            ? TupleDropBeforeAndTakeUntil<Tail, DropBefore, TakeUntil>
            : Tuple extends []
            ? // If don't find `DropBefore` in the tuple then return `never`.
              never
            : never;

        type TupleTakeUntil<
            Tuple extends Array<any>,
            TakeUntil extends any,
            AccTuple extends Array<any>,
        > = Tuple extends [TakeUntil, ...any]
            ? [TakeUntil, ...AccTuple]
            : Tuple extends [infer Head, ...infer Tail]
            ? // Optimization: We use tail recursion to optimize this type. Linked list
              // iteration can typically be written in a tail recursive fashion but it
              // reverses the order of the list.
              //
              // The non-tail recursive version would be something like:
              // `[Head, ...TupleTakeUntil<Tail, TakeUntil>]`.
              //
              // Because we use tail recursion it does mean the order of the list is
              // reversed. But since we convert this list back into a union the list order
              // doesn't matter.
              //
              // Learn more about tail recursion in TypeScript and why it's more
              // efficient here:
              // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5/#tailrec-conditional
              TupleTakeUntil<Tail, TakeUntil, [Head, ...AccTuple]>
            : Tuple extends []
            ? // If we don't find `TakeUntil` in the tuple then return `never`.
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
            readonly attributesSchema: SchemaSerializedValueDescription;
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
