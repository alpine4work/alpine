/**
 * When writing to a message stream, we ping the stream every 5 seconds to defend
 * against stale
 */
export const agentMessageStreamPingIntervalMs = 5 * 1000;
