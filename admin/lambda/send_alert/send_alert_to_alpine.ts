/* eslint-disable string-quotes */
/* eslint-disable no-console */
import {
    SendAlertAvailableChannel,
    sendAlertAvailableChannels,
} from "~/admin/lambda/send_alert/send_alert_available_channels.js";
import {GitHubActionsEventPayload} from "~/admin/lambda/send_alert/send_alert_github_actions.js";
import {HoneycombEventPayload} from "~/admin/lambda/send_alert/send_alert_honeycomb.js";
import {PagerDutyEventPayload} from "~/admin/lambda/send_alert/send_alert_pagerduty.js";

export function sendPagerDutyToAlpine(data: PagerDutyEventPayload) {
    const channel: SendAlertAvailableChannel = "alerts";
    const channelId = sendAlertAvailableChannels[channel];

    console.log("Received PagerDuty event:");
    console.log(JSON.stringify(data, null, 2));
    console.log(`Sending to ${channel} (${channelId})`);
    // TODO: Implement actual sending to Alpine
}

export function sendHoneycombToAlpine(data: HoneycombEventPayload) {
    const channel: SendAlertAvailableChannel =
        data.channel in sendAlertAvailableChannels
            ? (data.channel as SendAlertAvailableChannel)
            : "honeycomb";

    const channelId = sendAlertAvailableChannels[channel];

    console.log("Received Honeycomb event:");
    console.log(JSON.stringify(data, null, 2));
    console.log(`Sending to ${channel} (${channelId})`);
    // TODO: Implement actual sending to Alpine
}

export function sendGitHubActionsToAlpine(data: GitHubActionsEventPayload) {
    const channel: SendAlertAvailableChannel = "builds";
    const channelId = sendAlertAvailableChannels[channel];

    if (data.type !== "workflow_run") {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`Ignoring GitHub Actions event of type '${data.type}'`);
        return;
    }

    if (data.workflow_run.head_branch !== "main") {
        console.log(`Ignoring GitHub Actions event on branch '${data.workflow_run.head_branch}'`);
        return;
    }

    if (data.action !== "completed") {
        console.log(`Ignoring GitHub Actions workflow_run action '${data.action}'`);
        return;
    }

    if (data.workflow_run.conclusion !== "failure") {
        console.log(
            `Ignoring GitHub Actions workflow_run with conclusion '${data.workflow_run.conclusion}'`,
        );
        return;
    }

    console.log("Received GitHub Actions event:");
    console.log(JSON.stringify(data, null, 2));
    console.log(`Sending to ${channel} (${channelId})`);
    // TODO: Implement actual sending to Alpine
}
