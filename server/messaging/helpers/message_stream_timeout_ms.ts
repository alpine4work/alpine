import {agentMessageStreamPingIntervalMs} from "~/shared/agents/default_agent_message_ping_interval_ms.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";

/**
 * When writing to a message stream, we ping the stream every 5 seconds to keep the
 * Durable Object connection alive. If the Durable Object stops sending pings for
 * 10 seconds, we consider the stream to be "dead" and we don't allow any more
 * writes to the stream.
 */
export const messageStreamTimeoutMs = agentMessageStreamPingIntervalMs * 2;

/**
 * While performing server-side stream operations, we check to see if the stream
 * has timed out before allowing actions such as stream writes, stream completion,
 * and stream pings.
 *
 * On the server, we consider a stream to be stale if it has missed 3 pings. In
 * other words, it has not been updated for more than 15 seconds.
 */
// NOTE(ifitzsimmons, 2025-11-19) We split this logic out across server and client
// because the client is more suseptible to clock skew. See the PR comment here[1]
// for more.
//
// [1]:
//     https://app.graphite.com/github/pr/cyberworlds/cyberworlds/784/ping-API-to-keep-durable-object-alive#comment-PRRC_kwDOH2ktg86XX_c_
export function hasMessageStreamDefinitelyTimedOut({
    lastPingTime,
    createdTime,
}: {
    lastPingTime: Date | null;
    createdTime: Date;
}) {
    // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
    // and override the time that is returned.
    const currentTime = new Date(Date.now());

    const lastPingOrCreatedTime = lastPingTime ?? createdTime;
    const streamTimeoutTime = lastPingOrCreatedTime.getTime() + messageStreamTimeoutMs;

    return isDateDefinitelyLessThanWithUncertaintyWindow(streamTimeoutTime, currentTime);
}
