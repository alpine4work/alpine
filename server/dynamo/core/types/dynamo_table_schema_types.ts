import type {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaDescription,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import type {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {IdentityType} from "~/shared/helpers/types/identity_type.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import type {ObjectSchema, SchemaType} from "~/shared/schema/schema.js";
import {SchemaSerializedValueDescription} from "~/shared/schema/types/schema_description_types.js";

/**
 * Types for the `DynamoTableSchema` file. These types get a little complicated. So
 * we put them in a separate file and organize them with `namespace`s. `namespace`s
 * help clearly show the hierarchy of types.
 *
 * ### Concepts
 *
 * A table is comprised of one or more **partitions**. Each type of partition has
 * its own partition key.
 *
 * A partition is comprised of one or more **sort ranges**. Each type of sort range
 * has its own sort key.
 *
 * The partition key and sort key together make up a key for a single item in the
 * table.
 *
 * Partitions are ordered by their sort key. So the data within sort ranges are
 * stored physically next to each other! `DynamoKeyAttributeSchema` is responsible
 * for determining the order of keys.
 *
 * Partitions are not ordered relative to each other.
 *
 * This means it is efficient to query a range of data within a partition since it
 * lives next to each other. It is impossible to query a range of partitions since
 * while data within a partition is ordered, partitions are not ordered relative to
 * each other.
 */
export namespace DynamoTableSchemaTypes {
    /**
     * The configuration object provided by a developer when constructing a
     * `DynamoTableSchema`.
     *
     * We use the "base" naming convention because this type is used as an upper bound
     * of type parameters. Like in
     * `new<Config extends ConfigBase>(config: Config): Types<Config>`. Instantiations
     * of this type are much more interesting.
     *
     * Because this type is used as an upper bound for type parameters, it's fine to
     * use `any` within the type.
     *
     * Most of the types in this file "compute" some other type based on a config type.
     */
    export type ConfigBase = {
        readonly name: string;
        readonly partitions: ReadonlyArray<Partition.ConfigBase>;
        readonly withoutCompatibilityErrorsForTest?: boolean;
    };

    /**
     * The description object is generated from a `DynamoTableSchema` and saved to a
     * JSON file. See the documentation comments on `DynamoTableSchema._description`
     * and `DynamoTableSchema._config` for what makes a description and config
     * different.
     *
     * The short version is a description must be JSON serializable where as a config
     * doesn't need to be. Also descriptions contain `OrderKey`s for sort ranges since
     * those are generated and not configured by a developer.
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
         * `DynamoTableSchema.update()` function. If this property is not set it means we
         * have not yet called `DynamoTableSchema.update()` on this item.
         *
         * If the property does not exist, it is the same as if the value is 0. We don't
         * allow explicitly setting to 0, though, so that to test for version 0 we only
         * test for whether the property exists or not.
         *
         * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
         */
        readonly updateLockVersion?: number;
    };

    /**
     * Create the type of a DynamoDB item from the partition config and sort range
     * config for the item.
     */
    export type ItemType<
        PartitionConfig extends Partition.ConfigBase,
        SortRangeConfig extends SortRange.ConfigBase,
    > =
        | MergeObjectIntersection<
              {
                  readonly partitionType: PartitionConfig["name"];
                  readonly sortRangeType: SortRangeConfig["name"];
              } & KeyAttributes.Type<PartitionConfig["partitionKeyAttributes"]> &
                  KeyAttributes.Type<SortRangeConfig["sortKeyAttributes"]> &
                  SchemaType<SortRangeConfig["attributes"]> &
                  ExpirationTimeType<SortRangeConfig["withExpirationTime"]> &
                  ItemSharedAttributes
          >
        | (SortRangeConfig extends {childSortRanges: ReadonlyArray<SortRange.ChildConfigBase>}
              ? SortRange.ChildItemTypes<
                    PartitionConfig,
                    SortRangeConfig,
                    SortRangeConfig["childSortRanges"]
                >
              : never);

    type ChildItemType<
        PartitionConfig extends Partition.ConfigBase,
        ParentSortRangeConfig extends SortRange.ConfigBase,
        ChildSortRangeConfig extends SortRange.ChildConfigBase,
    > = MergeObjectIntersection<
        {
            readonly partitionType: PartitionConfig["name"];
            readonly sortRangeType: `${ParentSortRangeConfig["name"]}#${ChildSortRangeConfig["name"]}`;
        } & KeyAttributes.Type<PartitionConfig["partitionKeyAttributes"]> &
            KeyAttributes.Type<ParentSortRangeConfig["sortKeyAttributes"]> &
            KeyAttributes.Type<ChildSortRangeConfig["sortKeyAttributes"]> &
            SchemaType<ChildSortRangeConfig["attributes"]> &
            ExpirationTimeType<ChildSortRangeConfig["withExpirationTime"]> &
            ItemSharedAttributes
    >;

    type ExpirationTimeType<
        Config extends "Optional" | "Required" | "RequiredNullable" | undefined,
    > = Config extends "Optional"
        ? {readonly expirationTime?: Date}
        : Config extends "Required"
          ? {readonly expirationTime: Date}
          : Config extends "RequiredNullable"
            ? {readonly expirationTime: Date | null}
            : {};

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
            readonly id: number;
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
         *     | {partitionType: "A"; a: number}
         *     | {partitionType: "B"; b: number};
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
        export type SortKeyMapTypes<Config extends ReadonlyArray<ConfigBase>> = ObjectFromEntries<{
            [Index in keyof Config]: [
                Config[Index]["name"],
                SortRange.SortKeyTypes<Config[Index]["sortRanges"]>,
            ];
        }>;

        /**
         * The type of items in our table.
         *
         * An `ItemKey` is also a valid `ItemType`.
         *
         * There is a different type for every sort range in our table. This type is a
         * union of all types for all sort ranges.
         *
         * Excludes attributes from `partitionKeyAttributes` and `sortKeyAttributes`.
         *
         * Example:
         *
         * ```ts
         * type ItemType =
         *     | {partitionType: "A"; sortRangeType: "X"}
         *     | {partitionType: "A"; sortRangeType: "Y"}
         *     | {partitionType: "B"; sortRangeType: "X"}
         *     | {partitionType: "B"; sortRangeType: "Y"}
         *     | {partitionType: "B"; sortRangeType: "Z"};
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
         * There is a different key type for every sort range in our table. This type is a
         * union of all key types for all sort ranges.
         *
         * You can use `partitionType` to narrow down to an individual partition type and
         * then `sortRangeType` to narrow down to an individual sort range within that
         * partition.
         *
         * Attributes come from `partitionKeyAttributes` and `sortKeyAttributes`.
         *
         * Example:
         *
         * ```ts
         * type ItemKey =
         *     | {partitionType: "A"; a: number; sortRangeType: "X"; x: number}
         *     | {partitionType: "A"; a: number; sortRangeType: "Y"; y: number}
         *     | {partitionType: "B"; b: number; sortRangeType: "X"; x: number}
         *     | {partitionType: "B"; b: number; sortRangeType: "Y"; y: number}
         *     | {partitionType: "B"; b: number; sortRangeType: "Z"; z: number};
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
         * You can use `partitionType` to narrow down to an individual partition type and
         * then `sortRangeType` to narrow down to an individual sort range within that
         * partition.
         */
        export type ItemTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: SortRange.ItemTypes<
                Config[Index],
                Config[Index]["sortRanges"]
            >;
        }[number];

        /**
         * A map we use for determining the return type of the `query()` function.
         *
         * It is a map of partition types to sort range types to sort range types (again)
         * to a tuple of sort range types.
         *
         * The first sort range type is the "start" sort range type. Or the sort range type
         * of the start key in a query. The second sort range type is the "end" sort range
         * type. Or the sort range type of the end key in a query.
         *
         * The tuple of sort range types represents all sort ranges between the start sort
         * range type and the end sort range type.
         *
         * So by doing `QueryKeyMap[PartitionType][StartSortRangeType][EndSortRangeType]`
         * you will get a tuple of sort range types between start and end. The `query()`
         * function returns an item type that only includes items from those sort ranges.
         *
         * Remember sort range types can be formatted as
         * `${parentSortRange}#${childSortRange}` when the sort range has children. If a
         * query starts/ends in a child sort range then the result of this map is no
         * different than if the query starts/ends in the parent sort range. Because child
         * sort range items can be interleaved within their parent sort range. Their type
         * won't be homogenous.
         */
        export type QueryKeyMapType<Config extends ReadonlyArray<ConfigBase>> = ObjectFromEntries<{
            [Index in keyof Config]: [
                Config[Index]["name"],
                QueryKeyMapTypeStartMap<
                    Config[Index]["sortRanges"],
                    SortRangesTypeTuple<Config[Index]["sortRanges"]>
                >,
            ];
        }>;

        type QueryKeyMapTypeStartMap<
            Config extends ReadonlyArray<SortRange.ConfigBase>,
            SortTypes,
        > = MergeObjectIntersection<
            UnionToIntersection<
                {
                    [StartIndex in keyof Config]: QueryKeyMapTypeStartMapInner<
                        Config,
                        SortTypes,
                        Config[StartIndex]
                    >;
                }[number]
            >
        >;

        type QueryKeyMapTypeStartMapInner<
            AllConfigs extends ReadonlyArray<SortRange.ConfigBase>,
            SortTypes,
            Config extends SortRange.ConfigBase,
        > =
            | Record<Config["name"], QueryKeyMapTypeEndMap<AllConfigs, SortTypes, Config["name"]>>
            | (Config extends {
                  childSortRanges: infer ChildConfig extends
                      ReadonlyArray<SortRange.ChildConfigBase>;
              }
                  ? ChildQueryKeyMapTypeStartMap<AllConfigs, SortTypes, Config, ChildConfig>
                  : never);

        type ChildQueryKeyMapTypeStartMap<
            AllConfigs extends ReadonlyArray<SortRange.ConfigBase>,
            SortTypes,
            ParentConfig extends SortRange.ConfigBase,
            ChildConfigs extends ReadonlyArray<SortRange.ConfigBase>,
        > = {
            [Index in keyof ChildConfigs]: Record<
                `${ParentConfig["name"]}#${ChildConfigs[Index]["name"]}`,
                // If we start the query in a child sort range named
                // `${parentSortRange}#${childSortRange}` then treat it the same as if we had just
                // queried `${parentSortRange}`. Since you can have child sort range items of
                // different types interleaved within the parent sort range.
                QueryKeyMapTypeEndMap<AllConfigs, SortTypes, ParentConfig["name"]>
            >;
        }[number];

        type QueryKeyMapTypeEndMap<
            Config extends ReadonlyArray<SortRange.ConfigBase>,
            SortTypes,
            StartSortType extends string,
        > = MergeObjectIntersection<
            UnionToIntersection<
                {
                    [EndIndex in keyof Config]: QueryKeyMapTypeEndMapInner<
                        SortTypes,
                        StartSortType,
                        Config[EndIndex]
                    >;
                }[number]
            >
        >;

        type QueryKeyMapTypeEndMapInner<
            SortTypes,
            StartSortType extends string,
            Config extends SortRange.ConfigBase,
        > =
            | Record<
                  Config["name"],
                  TupleDropBeforeAndTakeUntil<SortTypes, StartSortType, Config["name"]>[number]
              >
            | (Config extends {
                  childSortRanges: infer ChildConfig extends
                      ReadonlyArray<SortRange.ChildConfigBase>;
              }
                  ? ChildQueryKeyMapTypeEndMap<SortTypes, StartSortType, Config, ChildConfig>
                  : never);

        type ChildQueryKeyMapTypeEndMap<
            SortTypes,
            StartSortType extends string,
            ParentConfig extends SortRange.ConfigBase,
            ChildConfigs extends ReadonlyArray<SortRange.ConfigBase>,
        > = {
            [EndIndex in keyof ChildConfigs]: Record<
                `${ParentConfig["name"]}#${ChildConfigs[EndIndex]["name"]}`,
                // If we end the query in a child sort range named
                // `${parentSortRange}#${childSortRange}` then treat it the same as if we had just
                // queried `${parentSortRange}`. Since you can have child sort range items of
                // different types interleaved within the parent sort range.
                TupleDropBeforeAndTakeUntil<SortTypes, StartSortType, ParentConfig["name"]>[number]
            >;
        }[number];

        export type SortRangesTypeTuple<Config extends ReadonlyArray<SortRange.ConfigBase>> =
            TupleFlat<{
                [Index in keyof Config]: SortRangeTypeTuple<Config[Index]>;
            }>;

        type SortRangeTypeTuple<Config extends SortRange.ConfigBase> = [
            Config["name"],
            ...(Config extends {
                childSortRanges: infer ChildConfig extends ReadonlyArray<SortRange.ChildConfigBase>;
            }
                ? ChildSortRangesTypeTuple<Config, ChildConfig>
                : []),
        ];

        type ChildSortRangesTypeTuple<
            ParentConfig extends SortRange.ConfigBase,
            ChildConfig extends ReadonlyArray<SortRange.ChildConfigBase>,
        > = {
            [Index in keyof ChildConfig]: `${ParentConfig["name"]}#${ChildConfig[Index]["name"]}`;
        };

        /**
         * Take a `Tuple` and return values between `DropBefore` and `TakeUntil`.
         *
         * So `TakeDropBeforeAndTakeUntil<["a", "b", "c", "d"], "b", "d">` is the same as
         * `["b", "c", "d"]`.
         *
         * We also return any values after `TakeUntil` that are prefixed by `${TakeUntil}#`
         * to support child sort ranges.
         */
        export type TupleDropBeforeAndTakeUntil<
            Tuple,
            DropBefore extends string,
            TakeUntil extends string,
        > = Tuple extends readonly [DropBefore, ...any]
            ? TupleTakeUntil<Tuple, TakeUntil, []>
            : Tuple extends readonly [any, ...infer Tail]
              ? TupleDropBeforeAndTakeUntil<Tail, DropBefore, TakeUntil>
              : Tuple extends readonly []
                ? // If don't find `DropBefore` in the tuple then return `never`.
                  never
                : never;

        type TupleTakeUntil<
            Tuple,
            TakeUntil extends string,
            AccTuple extends ReadonlyArray<any>,
        > = Tuple extends readonly [TakeUntil, ...infer Tail]
            ? TupleTakeWhilePrefix<Tail, TakeUntil, [TakeUntil, ...AccTuple]>
            : Tuple extends readonly [infer Head, ...infer Tail]
              ? // Optimization: We use tail recursion to optimize this type. Linked list iteration
                // can typically be written in a tail recursive fashion but it reverses the order
                // of the list.
                //
                // The non-tail recursive version would be something like:
                // `[Head, ...TupleTakeUntil<Tail, TakeUntil>]`.
                //
                // Because we use tail recursion it does mean the order of the list is reversed.
                // But since we convert this list back into a union the list order doesn't matter.
                //
                // Learn more about tail recursion in TypeScript and why it's more efficient here:
                // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5/#tailrec-conditional
                TupleTakeUntil<Tail, TakeUntil, [Head, ...AccTuple]>
              : Tuple extends readonly []
                ? // If we don't find `TakeUntil` in the tuple then return `never`.
                  never
                : never;

        // Take any values in the tuple that are prefixed by `${TakeWhilePrefix}#`. These
        // represent child sort ranges which should be included in any query that includes
        // their parent sort range.
        type TupleTakeWhilePrefix<
            Tuple,
            TakeWhilePrefix extends string,
            AccTuple extends ReadonlyArray<any>,
        > = Tuple extends readonly [
            infer Head extends `${TakeWhilePrefix}#${string}`,
            ...infer Tail,
        ]
            ? TupleTakeWhilePrefix<Tail, TakeWhilePrefix, [Head, ...AccTuple]>
            : AccTuple;

        type TupleFlat<Tuple extends ReadonlyArray<ReadonlyArray<unknown>>> =
            Tuple extends readonly [
                infer Head extends ReadonlyArray<unknown>,
                ...infer Tail extends ReadonlyArray<ReadonlyArray<unknown>>,
            ]
                ? [...Head, ...TupleFlat<Tail>]
                : Tuple;
    }

    export namespace SortRange {
        export type ConfigBase = {
            readonly name: string;
            readonly sortKeyAttributes: KeyAttributes.ConfigBase;
            readonly attributes: ObjectSchema<any>;

            /**
             * Enables the use of the `expirationTime` property for setting a [DynamoDB TTL on
             * items][1].
             *
             * If not provided, items will never expire `expirationTime`. If set to `Required`
             * then you must provide an `expirationTime` property with every item. If set to
             * `Optional` then you may provide an `expirationTime` with an item.
             *
             * [1]:
             *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-how-to.html
             */
            readonly withExpirationTime?: "Optional" | "Required" | "RequiredNullable";

            /**
             * A sort range may have child sort ranges. This lets you have heterogenous data
             * mixed within a sort range. Normally when you have multiple sort ranges, the data
             * within the sort range is totally homogenous. Imagine the following partition:
             *
             * ```
             * const partitionConfig = {
             *     name: "Task",
             *     partitionKeyAttributes: {
             *         taskId: DynamoKeyAttributeSchema.id<TaskId>(),
             *     },
             *     sortRanges: [
             *         {
             *             name: "Attributes",
             *             sortKeyAttributes: {},
             *         },
             *         {
             *             name: "Comments",
             *             sortKeyAttributes: {
             *                 commentIndex: DynamoKeyAttributeSchema.integer,
             *             },
             *             attributes: Schema.object({
             *                 // ...
             *             }),
             *         },
             *         {
             *             name: "Activity",
             *             sortKeyAttributes: {
             *                 createdTime: DynamoKeyAttributeSchema.integer,
             *             },
             *             attributes: Schema.object({
             *                 // ...
             *             }),
             *         },
             *     ],
             * };
             * ```
             *
             * This represents a task. `Comments` are the comments on the task and `Activity`
             * is a "change history" for the task. For example it contains items like "task
             * assignee updated" or "task notes updated". (As of 2025-09-17 this feature hasn't
             * been implemented, we may not design the data structure this way when we actually
             * implement the feature.)
             *
             * Let's say we have data that looks like this:
             *
             * ```
             * comment 0 (2:00pm): Hello, world!
             * comment 1 (2:01pm): My name is Caleb.
             * comment 2 (2:02pm): My name is Josh.
             * comment 3 (2:03pm): Josh Meredith or Josh Johnson?
             * comment 4 (2:04pm): I'm Josh Johnson! Not the rapper Josh Meredith.
             * comment 5 (4:01pm): How's your day going?
             * comment 6 (4:02pm): It's going well, what about you?
             * comment 7 (4:04pm): I'm doing good thanks, writing some TypeScript types.
             * comment 8 (4:05pm): Must be fun.
             * comment 9 (4:06pm): Yeah.
             *
             * activity 0 (1:00pm): Task created.
             * activity 1 (1:01pm): Task assigned to Caleb.
             * activity 2 (4:00pm): Caleb updated the task priority to "High".
             * activity 3 (4:03pm): Caleb updated the task notes.
             * ```
             *
             * Now let's say we want to query the task's comments + activities in chronological
             * order. The chronological order of this data is:
             *
             * ```
             * activity 0 (1:00pm): Task created.
             * activity 1 (1:01pm): Task assigned to Caleb.
             *
             * comment 0 (2:00pm): Hello, world!
             * comment 1 (2:01pm): My name is Caleb.
             * comment 2 (2:02pm): My name is Josh.
             * comment 3 (2:03pm): Josh Meredith or Josh Johnson?
             * comment 4 (2:04pm): I'm Josh Johnson! Not the rapper Josh Meredith.
             *
             * activity 2 (4:00pm): Caleb updated the task priority to "High".
             *
             * comment 5 (4:01pm): How's your day going?
             * comment 6 (4:02pm): It's going well, what about you?
             *
             * activity 3 (4:03pm): Caleb updated the task notes.
             *
             * comment 7 (4:04pm): I'm doing good thanks, writing some TypeScript types.
             * comment 8 (4:05pm): Must be fun.
             * comment 9 (4:06pm): Yeah.
             * ```
             *
             * If we want the last 8 comment + activity items that would be two activities and
             * six comments.
             *
             * Returning to our `partitionConfig` this query isn't supported because all the
             * data in a sort range is homogenous! We can only load comments and activities
             * separately. We can't run one query to load comments and activities together
             * (stopping once we reach some limit).
             *
             * `childSortRanges` lets you have heterogenous data mixed within a sort range.
             * Instead if you model the partition like this:
             *
             * ```
             * const partitionConfig = {
             *     name: "Task",
             *     partitionKeyAttributes: {
             *         taskId: DynamoKeyAttributeSchema.id<TaskId>(),
             *     },
             *     sortRanges: [
             *         {
             *             name: "Attributes",
             *             sortKeyAttributes: {},
             *         },
             *         {
             *             name: "Comments",
             *             sortKeyAttributes: {
             *                 commentIndex: DynamoKeyAttributeSchema.integer,
             *             },
             *             attributes: Schema.object({
             *                 // ...
             *             }),
             *             childSortRanges: [
             *                 {
             *                     name: "Activity",
             *                     sortKeyAttributes: {
             *                         createdTime: DynamoKeyAttributeSchema.integer,
             *                     },
             *                     attributes: Schema.object({
             *                         // ...
             *                     }),
             *                 },
             *             ],
             *         },
             *     ],
             * };
             * ```
             *
             * Now you can have `Comment#Activity` items that are interleaved with `Comment`
             * items. `Comment#Activity` items have a sort key that's the parent
             * `sortKeyAttributes` plus the child `sortKeyAttributes` (so `commentIndex` plus
             * `createdTime` in this case). They're sorted under the parent item with the same
             * sort key.
             */
            readonly childSortRanges?: ReadonlyArray<ChildConfigBase>;
        };

        export type ChildConfigBase = Omit<ConfigBase, "childSortRanges">;

        export type Description = {
            readonly id: number;
            readonly orderKey: OrderKey;
            readonly sortKeyAttributeByKey: {
                readonly [key: string]: DynamoKeyAttributeSchemaDescription;
            };
            readonly attributesSchema: SchemaSerializedValueDescription;
            readonly childSortRangeByType: {
                readonly [type: string]: ChildDescription;
            };
        };

        type ChildDescription = Omit<Description, "childSortRangeByType">;

        export type SortKeyTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: SortKeyType<Config[Index]>;
        }[number];

        type SortKeyType<Config extends ConfigBase> =
            | MergeObjectIntersection<
                  {
                      readonly sortRangeType: Config["name"];
                  } & KeyAttributes.Type<Config["sortKeyAttributes"]>
              >
            | (Config extends {
                  childSortRanges: infer ChildConfig extends ReadonlyArray<ChildConfigBase>;
              }
                  ? ChildSortKeyTypes<Config, ChildConfig>
                  : never);

        type ChildSortKeyTypes<
            ParentConfig extends ConfigBase,
            ChildConfig extends ReadonlyArray<ChildConfigBase>,
        > = {
            [Index in keyof ChildConfig]: ChildSortKeyType<ParentConfig, ChildConfig[Index]>;
        }[number];

        type ChildSortKeyType<
            ParentConfig extends ConfigBase,
            ChildConfig extends ChildConfigBase,
        > = MergeObjectIntersection<
            {
                readonly sortRangeType: `${ParentConfig["name"]}#${ChildConfig["name"]}`;
            } & KeyAttributes.Type<ChildConfig["sortKeyAttributes"]>
        >;

        export type ItemTypeTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemTypeType<Config[Index]>;
        }[number];

        type ItemTypeType<Config extends ConfigBase> =
            | {
                  readonly sortRangeType: Config["name"];
              }
            | (Config extends {
                  childSortRanges: infer ChildConfig extends ReadonlyArray<ChildConfigBase>;
              }
                  ? ChildItemTypeTypes<Config, ChildConfig>
                  : never);

        type ChildItemTypeTypes<
            ParentConfig extends ConfigBase,
            ChildConfig extends ReadonlyArray<ChildConfigBase>,
        > = {
            [Index in keyof ChildConfig]: ChildItemTypeType<ParentConfig, ChildConfig[Index]>;
        }[number];

        type ChildItemTypeType<
            ParentConfig extends ConfigBase,
            ChildConfig extends ChildConfigBase,
        > = {
            readonly sortRangeType: `${ParentConfig["name"]}#${ChildConfig["name"]}`;
        };

        export type ItemKeyTypes<Config extends ReadonlyArray<ConfigBase>> = {
            [Index in keyof Config]: ItemKeyType<Config[Index]>;
        }[number];

        type ItemKeyType<Config extends ConfigBase> =
            | ({
                  readonly sortRangeType: Config["name"];
              } & KeyAttributes.Type<Config["sortKeyAttributes"]>)
            | (Config extends {
                  childSortRanges: infer ChildConfig extends ReadonlyArray<ChildConfigBase>;
              }
                  ? ChildItemKeyTypes<Config, ChildConfig>
                  : never);

        type ChildItemKeyTypes<
            ParentConfig extends ConfigBase,
            ChildConfig extends ReadonlyArray<ChildConfigBase>,
        > = {
            [Index in keyof ChildConfig]: ChildItemKeyType<ParentConfig, ChildConfig[Index]>;
        }[number];

        type ChildItemKeyType<
            ParentConfig extends ConfigBase,
            ChildConfig extends ChildConfigBase,
        > = {
            readonly sortRangeType: `${ParentConfig["name"]}#${ChildConfig["name"]}`;
        } & KeyAttributes.Type<ParentConfig["sortKeyAttributes"]> &
            KeyAttributes.Type<ChildConfig["sortKeyAttributes"]>;

        export type ItemTypes<
            PartitionConfig extends Partition.ConfigBase,
            Config extends ReadonlyArray<ConfigBase>,
        > = {
            [Index in keyof Config]: ItemType<PartitionConfig, Config[Index]>;
        }[number];

        export type ChildItemTypes<
            PartitionConfig extends Partition.ConfigBase,
            ParentConfig extends ConfigBase,
            ChildConfig extends ReadonlyArray<ChildConfigBase>,
        > = {
            [Index in keyof ChildConfig]: ChildItemType<
                PartitionConfig,
                ParentConfig,
                ChildConfig[Index]
            >;
        }[number];
    }

    export namespace Index {
        /**
         * Our DynamoDB indexes are [overloaded][1]. Separate logical indexes on different
         * item types may share the same physical index. A single item type may not be
         * indexed twice in the same overload.
         *
         * [1]:
         *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-gsi-overloading.html
         */
        export type Description = {
            readonly projection: "KeysOnly" | "All";
            readonly partitionKeyBehavior:
                | {readonly type: "Separate"}
                | {readonly type: "Reused"; readonly partitionType: string};
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
