/**
 * DynamoDB reads may either have [`Eventual` consistency or `Strong`
 * consistency][1]. Eventually consistent reads are faster and cheaper but you may
 * see old data for a short window of time after a write (typically <1 second).
 *
 * For a great article explaining DynamoDB consistency models and latency
 * expectations read "[Understanding Eventual Consistency in DynamoDB][2]."
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
 * [2]: https://www.alexdebrie.com/posts/dynamodb-eventual-consistency
 */
export type DynamoReadConsistency = "Eventual" | "Strong";

/**
 * Read consistency for `DynamoContextCache`. Includes the special
 * `StrongWithinCache` consistency which will reuse data from the cache if that
 * data was read with strong consistency. This special consistency is useful for
 * performance if you want your reads to be strongly consistent as of cache
 * creation time since we can get some cache reuse whereas `Strong` consistency
 * always needs to reload data.
 */
export type DynamoCacheReadConsistency = DynamoReadConsistency | "StrongWithinCache";
