import {AlertSource} from "~/admin/lambda/send_alert/internal/alert_source.js";
import {AlertSourceRequest} from "~/admin/lambda/send_alert/internal/alert_source_request_types.js";
import {GitHubAlertSource} from "~/admin/lambda/send_alert/internal/github_alert_source.js";
import {HoneycombAlertSource} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source.js";
import {PagerDutyAlertSource} from "~/admin/lambda/send_alert/internal/pagerduty_alert_source.js";
import {UnsupportedAlertSource} from "~/admin/lambda/send_alert/internal/unsupported_alert_source.js";

export class AlertSourceFactory {
    static create(request: AlertSourceRequest): AlertSource {
        const {headers} = request;
        const sourceHeaders = [
            "x-pagerduty-signature",
            "x-honeycomb-webhook-token",
            "x-hub-signature-256",
        ].filter(header => header in headers);

        if (sourceHeaders.length !== 1) {
            return new UnsupportedAlertSource(request);
        }

        const sourceHeader = sourceHeaders[0]!;
        switch (sourceHeader) {
            case "x-pagerduty-signature":
                return new PagerDutyAlertSource(request);
            case "x-honeycomb-webhook-token":
                return new HoneycombAlertSource(request);
            case "x-hub-signature-256":
                return new GitHubAlertSource(request);
            default:
                return new UnsupportedAlertSource(request);
        }
    }
}
