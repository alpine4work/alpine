import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

// Ideally block items are ~2kb in size each. From one basic experiment, 10 post
// entries are 1.78kb as a minified JSON string. We'd really benefit from binary
// encoding here. We could put many more entries in a single block item.
export const feedEntryBlockMaxEntryCount = 10;

const FeedCandidateEntrySchema = FeedEntrySchema.validation(
    "Welcome feed entry isn\u2019t allowed as feed candidate entry",
    (entry): entry is Exclude<FeedEntry, {type: "Welcome"}> => entry.type !== "Welcome",
);

export const FeedTable = DynamoTableSchema.new({
    name: "Feed",
    partitions: [
        /**
         * Feed candidates are all the possible feed entries for a space. Whenever we want
         * to add something to the feed we add it to the feed candidates partition for the
         * space.
         *
         * To determine the entries in a user's personal feed we look at the recent feed
         * candidates, filter out entries the user doesn't have access to, rank the entries
         * (as of 2025-05-19 we only sort chronologically but eventually we should use a
         * [recommender system][1]), and add to the user's personal feed.
         *
         * `FeedAccountCandidates` is an account-specific candidate list.
         *
         * [1]: https://en.wikipedia.org/wiki/Recommender_system
         */
        {
            name: "FeedCandidates",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                /**
                 * Item with state required for adding feed candidates. Namely the next index in
                 * the feed candidate index sequence. Feed candidate entries are given an
                 * auto-incrementing index. This way when processing a user's personal feed we can
                 * say "find me all feed candidate entries after the last index I've seen".
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        nextIndex: Schema.integer.min(0),
                    }),
                },

                /**
                 * A feed candidate entry in (almost) chronological order. Some entries are only
                 * added after a delay (e.g. as of 2025-05-19 documents are added to feed ~15min
                 * after they are made public).
                 */
                {
                    name: "Entry",
                    sortKeyAttributes: {
                        // Entries are in reverse order so we can efficiently load the `Attributes` item
                        // along with the newest entries.
                        index: DynamoKeyAttributeSchema.integer.reverse(),
                    },
                    attributes: Schema.object({
                        entry: FeedCandidateEntrySchema,
                    }),
                },
            ],
        },

        /**
         * Same as `FeedCandidates` but for a single account. These candidates will only
         * ever be added to an individual account's feed. Useful for when an account
         * creates a private document. We'll add the private document to their account
         * candidates and not the space-wide candidates list.
         *
         * Why don't we add directly to an account's feed? Well right now (2025-05-27)
         * given feeds are purely chronological we certainly could directly add entries to
         * the account's feed. However, when we add feed ranking in the future (which we
         * will definitely do) we'll need feed account candidates anyway. So might as well
         * start with this partition given it's not too much extra complexity.
         *
         * See `FeedCandidates` for detailed documentation. This partition follows
         * basically the same data structure.
         */
        {
            name: "FeedAccountCandidates",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        nextIndex: Schema.integer.min(0),
                    }),
                },
                {
                    name: "Entry",
                    sortKeyAttributes: {
                        index: DynamoKeyAttributeSchema.integer.reverse(),
                    },
                    attributes: Schema.object({
                        entry: FeedCandidateEntrySchema,
                    }),
                },
            ],
        },

        /**
         * An individual account's feed in a space. We calculate each feed from the space's
         * feed candidates.
         */
        {
            name: "Feed",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                /**
                 * Item with state for calculating the account's feed.
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The next index in the entry block index sequence. Not to be confused with the
                         * candidate index sequence.
                         */
                        nextIndex: Schema.integer.min(0),

                        /**
                         * The last `FeedCandidates` index we saw when calculating this account's feed.
                         * When we go to calculate new entries in the account's feed we'll start from this
                         * index and load all new candidates.
                         */
                        lastCandidateIndex: Schema.integer.min(0).nullable(),

                        /**
                         * The last `FeedAccountCandidates` index we saw when calculating this account's
                         * feed. When we go to calculate new entries in the account's feed we'll start from
                         * this index and load all new candidates.
                         */
                        lastAccountCandidateIndex: Schema.integer.min(0).nullable(),

                        /**
                         * The last time the account's feed was updated.
                         */
                        lastUpdatedTime: Schema.date,
                    }),
                },

                /**
                 * A block of entries in the account's feed. The first entry in the feed is the
                 * block with the highest `index` and index 0 in the block item's `entries` array.
                 *
                 * When we calculate the account's feed we only include feed entries the account
                 * has access to at calculation time. If an account loses access to an entity
                 * referenced in their feed then the item will disappear when they load the feed
                 * but it'll still technically be stored so if they gain access back they'll see
                 * the feed entry again. However, if an account doesn't have access at feed
                 * calculation time and later they're granted access to the entity then the entity
                 * will never show up in the account's feed.
                 *
                 * We put entries in a block as an optimization to save DynamoDB WCUs at the
                 * potential cost of some RCUs. Since writing one item is minimum 2 WCUs. So
                 * writing three separate entry items is 6 WCUs but writing one entry block item is
                 * 2 WCUs (as long as the item is under 1kb). The tradeoff is when reading the feed
                 * we may read more entries than necessary. We accept this tradeoff since entries
                 * are small. We can tune how much over-reading happens by changing
                 * `feedEntryBlockMaxEntryCount`. At most you'll read 9 entries extra since
                 * `feedEntryBlockMaxEntryCount` is 10.
                 */
                {
                    name: "EntryBlock",
                    sortKeyAttributes: {
                        // Entries are in reverse order so we can efficiently load the `Attributes` item
                        // along with the newest entries.
                        index: DynamoKeyAttributeSchema.integer.reverse(),
                    },
                    attributes: Schema.object({
                        /**
                         * The time when we added this entry block to the account's feed.
                         */
                        addedTime: Schema.date,

                        /**
                         * The feed entries in this block. Each entry block must have at least one entry.
                         */
                        entries: Schema.array(FeedEntrySchema)
                            .minLength(1)
                            .maxLength(feedEntryBlockMaxEntryCount),
                    }),
                },
            ],
        },
    ],
});
