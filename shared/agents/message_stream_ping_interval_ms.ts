/**
 * When writing to a message stream, we ping the stream every 4 seconds to defend
 * against stale messages being automtically completed.
 *
 * We pick 4 seconds because the message stream expiration time is 10 seconds. This
 * allows us to miss one full ping interval without the stream expiring. For
 * example, if `claude_agent_service.ts` acknowledges a message at t + 3,999 (right
 * before `run_claude_agent_webhook.ts` would send a ping) and sets up its own ping
 * interval at the same time then `claude_agent_service.ts` won't send a ping until
 * t + 7,999 which is less than t + 10,000 and so the stream won't have expired in
 * that time.
 */
export const messageStreamPingIntervalMs = 4 * 1000;
