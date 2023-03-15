import type {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaDescription,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import type {OrderKey} from "~/shared/helpers/sort/order_key";
import {IdentityType} from "~/shared/helpers/types/identity_type";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection";
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
        readonly partitions: ReadonlyArray<Partition.ConfigBase>;
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
        readonly indexes: ReadonlyArray<Index.Description>;
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
        PartitionKey: Partition.PartitionKeyTypes<Config["partitions"]>;
        SortKeyMap: Partition.SortKeyMapTypes<Config["partitions"]>;
        ItemType: Partition.ItemTypeTypes<Config["partitions"]>;
        ItemKey: Partition.ItemKeyTypes<Config["partitions"]>;
        Item: Partition.ItemTypes<Config["partitions"]>;
        QueryKeyMap: Partition.QueryKeyMapType<Config["partitions"]>;
    };

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
     * Types shared by both `partitionKeyAttributes` and `sortKeyAttributes`.
     */
    export namespace KeyAttributes {
        export type ConfigBase = {
            readonly [key: string]: DynamoKeyAttributeSchema<any>;
        };

        export type Type<Config extends ConfigBase> = IdentityType<{
            readonly [Key in keyof Config]: DynamoKeyAttributeSchemaType<Config[Key]>;
        }>;
    }

    export namespace Partition {
        export type ConfigBase = {
            readonly name: string;
            readonly partitionKeyAttributes: KeyAttributes.ConfigBase;
            readonly sortRanges: ReadonlyArray<SortRange.ConfigBase>;
        };

        export type Description = {
            readonly partitionKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
            readonly sortRangeByType: {
                readonly [type: string]: SortRange.Description;
            };
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
        export type PartitionKeyTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: PartitionKeyType<Config[Index]>;
        }[number];

        type PartitionKeyType<Config extends ConfigBase> = MergeObjectIntersection<
            {
                readonly partitionType: Config["name"];
            } & KeyAttributes.Type<Config["partitionKeyAttributes"]>
        >;

        /**
         * A map of partition type to the sort key type union for that partition.
         */
        export type SortKeyMapTypes<Config extends ReadonlyArray<ConfigBase>> =
            MergeObjectIntersection<
                UnionToIntersection<
                    {
                        [Index in keyof Config]: {
                            [Key in Config[Index]["name"]]: SortRange.SortKeyTypes<
                                Config[Index]["sortRanges"]
                            >;
                        };
                    }[number]
                >
            >;

        /**
         * The type of items in our table.
         *
         * An `ItemKey` is also a valid `ItemType`.
         *
         * There is a different type for every sort range in our table. This type
         * is a union of all types for all sort ranges.
         *
         * Excludes attributes from `partitionKeyAttributes` and `sortKeyAttributes`.
         *
         * Example:
         *
         * ```ts
         * type ItemType =
         *     | {partitionType: "A", sortRangeType: "X"}
         *     | {partitionType: "A", sortRangeType: "Y"}
         *     | {partitionType: "B", sortRangeType: "X"}
         *     | {partitionType: "B", sortRangeType: "Y"}
         *     | {partitionType: "B", sortRangeType: "Z"};
         * ```
         */
        export type ItemTypeTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemTypeType<Config[Index]>;
        }[number];

        type ItemTypeType<Config extends ConfigBase> = MergeObjectIntersection<
            {
                readonly partitionType: Config["name"];
            } & SortRange.ItemTypeTypes<Config["sortRanges"]>
        >;

        /**
         * The type of key for our type. A key identifies an item in the table.
         *
         * An `ItemKey` is also a valid `PartitionKey`.
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
         * type ItemKey =
         *     | {partitionType: "A", a: number, sortRangeType: "X", x: number}
         *     | {partitionType: "A", a: number, sortRangeType: "Y", y: number}
         *     | {partitionType: "B", b: number, sortRangeType: "X", x: number}
         *     | {partitionType: "B", b: number, sortRangeType: "Y", y: number}
         *     | {partitionType: "B", b: number, sortRangeType: "Z", z: number};
         * ```
         */
        export type ItemKeyTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemKeyType<Config[Index]>;
        }[number];

        type ItemKeyType<Config extends ConfigBase> = MergeObjectIntersection<
            {
                readonly partitionType: Config["name"];
            } & KeyAttributes.Type<Config["partitionKeyAttributes"]> &
                SortRange.ItemKeyTypes<Config["sortRanges"]>
        >;

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
        export type ItemTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemType<Config[Index]>;
        }[number];

        type ItemType<Config extends ConfigBase> = MergeObjectIntersection<
            {
                readonly partitionType: Config["name"];
            } & KeyAttributes.Type<Config["partitionKeyAttributes"]> &
                SortRange.ItemTypes<Config["sortRanges"]> &
                ItemSharedAttributes
        >;

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
        export type QueryKeyMapType<Config extends ReadonlyArray<ConfigBase>> =
            MergeObjectIntersection<
                UnionToIntersection<
                    {
                        [Index in keyof Config]: {
                            [Key in Config[Index]["name"]]: QueryKeyMapTypeStartMap<
                                Config[Index]["sortRanges"],
                                SortRangeTypeTuple<Config[Index]["sortRanges"]>
                            >;
                        };
                    }[number]
                >
            >;

        type SortRangeTypeTuple<Config extends ConfigBase["sortRanges"]> = {
            [Index in keyof Config]: Config[Index]["name"];
        };

        type QueryKeyMapTypeStartMap<
            Config extends ConfigBase["sortRanges"],
            SortTypes,
        > = MergeObjectIntersection<
            UnionToIntersection<
                {
                    [StartIndex in keyof Config]: {
                        [Key in Config[StartIndex]["name"]]: QueryKeyMapTypeEndMap<
                            Config,
                            SortTypes,
                            Config[StartIndex]["name"]
                        >;
                    };
                }[number]
            >
        >;

        type QueryKeyMapTypeEndMap<
            Config extends ConfigBase["sortRanges"],
            SortTypes,
            StartSortType extends string,
        > = MergeObjectIntersection<
            UnionToIntersection<
                {
                    [EndIndex in keyof Config]: {
                        [Key in Config[EndIndex]["name"]]: TupleDropBeforeAndTakeUntil<
                            SortTypes,
                            StartSortType,
                            Config[EndIndex]["name"]
                        >[number];
                    };
                }[number]
            >
        >;

        /**
         * Take a `Tuple` and return values between `DropBefore` and `TakeUntil`.
         *
         * So `TakeDropBeforeAndTakeUntil<["a", "b", "c", "d"], "b", "d">` is the
         * same as `["b", "c", "d"]`.
         */
        export type TupleDropBeforeAndTakeUntil<Tuple, DropBefore, TakeUntil> =
            Tuple extends readonly [DropBefore, ...any]
                ? TupleTakeUntil<Tuple, TakeUntil, []>
                : Tuple extends readonly [any, ...infer Tail]
                ? TupleDropBeforeAndTakeUntil<Tail, DropBefore, TakeUntil>
                : Tuple extends readonly []
                ? // If don't find `DropBefore` in the tuple then return `never`.
                  never
                : never;

        type TupleTakeUntil<
            Tuple,
            TakeUntil,
            AccTuple extends ReadonlyArray<any>,
        > = Tuple extends readonly [TakeUntil, ...any]
            ? [TakeUntil, ...AccTuple]
            : Tuple extends readonly [infer Head, ...infer Tail]
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
            : Tuple extends readonly []
            ? // If we don't find `TakeUntil` in the tuple then return `never`.
              never
            : never;
    }

    export namespace SortRange {
        export type ConfigBase = {
            readonly name: string;
            readonly sortKeyAttributes: KeyAttributes.ConfigBase;
            readonly attributes: ObjectSchema<any>;
            /**
             * Enables the use of the `expirationTime` property for setting a [DynamoDB TTL
             * on items][1].
             *
             * If not provided, items will never expire `expirationTime`. If set to
             * `Required` then you must provide an `expirationTime` property with every
             * item. If set to `Optional` then you may provide an `expirationTime` with
             * an item.
             *
             * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-how-to.html
             */
            readonly withExpirationTime?: "Optional" | "Required";
        };

        export type Description = {
            readonly orderKey: OrderKey;
            readonly sortKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
            readonly attributesSchema: SchemaSerializedValueDescription;
        };

        export type SortKeyTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: SortKeyType<Config[Index]>;
        }[number];

        type SortKeyType<Config extends ConfigBase> = MergeObjectIntersection<
            {
                readonly sortRangeType: Config["name"];
            } & KeyAttributes.Type<Config["sortKeyAttributes"]>
        >;

        export type ItemTypeTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: {
                readonly sortRangeType: Config[Index]["name"];
            };
        }[number];

        export type ItemKeyTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemKeyType<Config[Index]>;
        }[number];

        type ItemKeyType<Config extends ConfigBase> = {
            readonly sortRangeType: Config["name"];
        } & KeyAttributes.Type<Config["sortKeyAttributes"]>;

        export type ItemTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemType<Config[Index]>;
        }[number];

        type ItemType<Config extends ConfigBase> = {
            readonly sortRangeType: Config["name"];
        } & KeyAttributes.Type<Config["sortKeyAttributes"]> &
            SchemaType<Config["attributes"]> &
            ExpirationTimeType<Config["withExpirationTime"]>;

        type ExpirationTimeType<Config extends "Optional" | "Required" | undefined> =
            Config extends "Optional"
                ? {readonly expirationTime?: Date}
                : Config extends "Required"
                ? {readonly expirationTime: Date}
                : {};
    }

    export namespace Index {
        /**
         * Our DynamoDB indexes are [overloaded][1]. Separate logical indexes on
         * different item types may share the same physical index. A single item type
         * may not be indexed twice in the same overload.
         *
         * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-gsi-overloading.html
         */
        export type Description = {
            readonly overloadByName: {
                readonly [name: string]: OverloadDescription;
            };
        };

        export type OverloadDescription = {
            readonly itemTypes: ReadonlyArray<{
                readonly partitionType: string;
                readonly sortRangeType: string;
            }>;
            readonly partitionKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
            readonly sortKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
        };
    }
}
