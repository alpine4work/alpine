/**
 * DynamoDB reads may either have [`Eventual` consistency or `Strong`
 * consistency][1]. Eventually consistent reads are faster and cheaper but you
 * may see old data for a short window of time after a write (typically <1
 * second).
 *
 * For a great article explaining DynamoDB consistency models and latency
 * expectations read “[Understanding Eventual Consistency in DynamoDB][2].”
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
 * [2]: https://www.alexdebrie.com/posts/dynamodb-eventual-consistency
 */
export type DynamoReadConsistency = "Eventual" | "Strong";
