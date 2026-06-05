import {AlertSourceFactory} from "~/admin/lambda/send_alert/internal/alert_source_factory.js";
import {AlertSourceRequest} from "~/admin/lambda/send_alert/internal/alert_source_request_types.js";
import {GitHubAlertSource} from "~/admin/lambda/send_alert/internal/github_alert_source.js";
import {HoneycombAlertSource} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source.js";
import {PagerDutyAlertSource} from "~/admin/lambda/send_alert/internal/pagerduty_alert_source.js";
import {UnsupportedAlertSource} from "~/admin/lambda/send_alert/internal/unsupported_alert_source.js";

function createRequest(headers: Record<string, string>): AlertSourceRequest {
    return {
        body: "{}",
        headers,
        httpMethod: "POST",
        isBase64Encoded: false,
        requestContext: {
            http: {
                method: "POST",
                path: "/",
                sourceIp: "127.0.0.1",
            },
        },
    };
}

describe("AlertSourceFactory", () => {
    test("creates PagerDuty alert source", () => {
        const alertSource = AlertSourceFactory.create(
            createRequest({"x-pagerduty-signature": "v1=signature"}),
        );

        expect(alertSource).toBeInstanceOf(PagerDutyAlertSource);
    });

    test("creates Honeycomb alert source", () => {
        const alertSource = AlertSourceFactory.create(
            createRequest({"x-honeycomb-webhook-token": "token"}),
        );

        expect(alertSource).toBeInstanceOf(HoneycombAlertSource);
    });

    test("creates GitHub alert source", () => {
        const alertSource = AlertSourceFactory.create(
            createRequest({"x-hub-signature-256": "sha256=signature"}),
        );

        expect(alertSource).toBeInstanceOf(GitHubAlertSource);
    });

    test("creates unsupported alert source for unknown headers", () => {
        const alertSource = AlertSourceFactory.create(createRequest({}));

        expect(alertSource).toBeInstanceOf(UnsupportedAlertSource);
    });

    test("creates unsupported alert source for multiple source headers", () => {
        const alertSource = AlertSourceFactory.create(
            createRequest({
                "x-pagerduty-signature": "v1=signature",
                "x-honeycomb-webhook-token": "token",
                "x-hub-signature-256": "sha256=signature",
            }),
        );

        expect(alertSource).toBeInstanceOf(UnsupportedAlertSource);
    });
});
