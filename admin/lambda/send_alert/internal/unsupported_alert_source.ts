import {AlertSource} from "~/admin/lambda/send_alert/internal/alert_source.js";
import {
    AlertSourceAuthorizationResult,
    SendAlertResult,
} from "~/admin/lambda/send_alert/internal/alert_source_types.js";

export class UnsupportedAlertSource extends AlertSource {
    override validateAuthorization(): AlertSourceAuthorizationResult {
        return {ok: false, statusCode: 400, error: "Invalid headers"};
    }

    override async handlePayload(): Promise<SendAlertResult> {
        return {ok: false, statusCode: 400, error: "Invalid headers"};
    }
}
