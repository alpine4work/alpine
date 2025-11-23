import {getSynchronizedSystemClock} from "~/client/web/tracer/synchronized_system_clock.js";
import {defaultAgentMessagePingIntervalMs} from "~/shared/agents/default_agent_message_ping_interval_ms.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";

/**
 * When writing to a message stream, the agent pings the stream every 5 seconds to keep the
 * stream alive. On the server, we consider a stream to be "dead" after 3 missed pings (15 seconds),
 * after which we don't allow any more writes to the stream.
 *
 * On the client, we wait an extra cycle (20 seconds total) to render an error message because the client's clock
 * may be slightly ahead of of the server's clock.
 */
export const messageStreamTimeoutClientLimitMs = defaultAgentMessagePingIntervalMs * 4;

/**
 * The maximum amount of time we wait before considering a stream to be "dead" on the client.
 */
// NOTE(ifitzsimmons, 2025-11-19) We split this logic out across server and client because
// the client is more suseptible to clock skew. See the PR comment here[1] for more.
//
// [1]: https://app.graphite.com/github/pr/cyberworlds/cyberworlds/784/ping-API-to-keep-durable-object-alive#comment-PRRC_kwDOH2ktg86XX_c_
export const hasMessageStreamTimedOutOnClient = ({
    lastPingTime,
    createdTime,
}: {
    lastPingTime: Date | null;
    createdTime: Date;
}) => {
    // See comment [1] for guidance on using sycnhronized system clock on client.
    //
    // [1]: https://app.graphite.com/github/pr/cyberworlds/cyberworlds/784/ping-API-to-keep-durable-object-alive#comment-PRRC_kwDOH2ktg86XX_c_
    const clock =
        getSynchronizedSystemClock().getStateWithoutListening().value ?? unsynchronizedSystemClock;

    const lastPingOrCreatedTime = lastPingTime ?? createdTime;
    const streamTimeoutTime = lastPingOrCreatedTime.getTime() + messageStreamTimeoutClientLimitMs;

    return isDateDefinitelyLessThanWithUncertaintyWindow(streamTimeoutTime, clock.now());
};
