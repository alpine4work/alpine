import {assertId} from "~/shared/id/id.js";
import type {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Maps alert channel names used by webhook sources to Alpine channel ids.
 *
 * Source implementations select one of these names before posting through the base
 * `AlertSource` helper.
 */
export const sendAlertAvailableChannels = {
    alerts: assertId<ChannelId>(
        process.env.SEND_ALERT_ALERTS_CHANNEL_ID || "qt3xsqhh2fed7t8fyqnbfw0m3g",
    ),
    beta_alerts: assertId<ChannelId>(
        process.env.SEND_ALERT_BETA_ALERTS_CHANNEL_ID || "2mas644bdgs8zscq2a6bzktzqm",
    ),
    honeycomb: assertId<ChannelId>(
        process.env.SEND_ALERT_HONEYCOMB_CHANNEL_ID || "6dvn4zd99fwvzehdcjhmb0h1s0",
    ),
    builds: assertId<ChannelId>(
        process.env.SEND_ALERT_BUILDS_CHANNEL_ID || "c62kgg77zybqev6kkm77wza5gr",
    ),
    github: assertId<ChannelId>(
        process.env.SEND_ALERT_GITHUB_CHANNEL_ID || "cw0bwdj673tafptr8aete3ma8c",
    ),
};

/**
 * Channel names that the send alert Lambda can post to.
 */
export type SendAlertAvailableChannel = keyof typeof sendAlertAvailableChannels;
