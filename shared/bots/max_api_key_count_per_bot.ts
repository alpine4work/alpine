/**
 * How many API keys a single bot may have at once.
 *
 * Deleting a bot deletes every one of its API keys in a single DynamoDB
 * transaction, so this must stay well under the 100 item transaction limit. It's
 * also a security guardrail: the more keys an owner creates, the more chances
 * there are for one to leak.
 */
export const maxApiKeyCountPerBot = 10;
