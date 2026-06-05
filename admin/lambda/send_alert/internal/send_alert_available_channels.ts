/**
 * Maps alert channel names used by webhook sources to Alpine channel ids.
 *
 * Source implementations select one of these names before posting through the base
 * `AlertSource` helper.
 */
export const sendAlertAvailableChannels = {
    alerts: "qt3xsqhh2fed7t8fyqnbfw0m3g",
    beta_alerts: "2mas644bdgs8zscq2a6bzktzqm",
    honeycomb: "6dvn4zd99fwvzehdcjhmb0h1s0",
    builds: "c62kgg77zybqev6kkm77wza5gr",
    github: "cw0bwdj673tafptr8aete3ma8c",
};

/**
 * Channel names that the send alert Lambda can post to.
 */
export type SendAlertAvailableChannel = keyof typeof sendAlertAvailableChannels;
