import {messageStreamTimeoutMs} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

const timeoutInSeconds = Math.round(messageStreamTimeoutMs / 1000);

export function createCantCompleteStaleMessageStreamError() {
    return new FailedPreconditionError("The stream has timed out", {
        displayMessage: errorDisplayMessage`Can\u2019t complete a message stream that has timed out after ${timeoutInSeconds} seconds of inactivity. If you have a long running process updating a message stream, then during periods of inactivity occasionally ping the message stream so it doesn\u2019t time out.`,
    });
}

export function createCantWriteToStaleMessageStreamError() {
    return new FailedPreconditionError("The stream has timed out", {
        displayMessage: errorDisplayMessage`Can\u2019t put message part for a message stream that has timed out after ${timeoutInSeconds} seconds of inactivity. If you have a long running process updating a message stream, then during periods of inactivity occasionally ping the message stream so it doesn\u2019t time out.`,
    });
}

export function createCantPingStaleMessageStreamError() {
    return new FailedPreconditionError("The stream has timed out", {
        displayMessage: errorDisplayMessage`Can\u2019t ping a message stream that has timed out after ${timeoutInSeconds} seconds of inactivity. If you have a long running process updating a message stream, then during periods of inactivity occasionally ping the message stream so it doesn\u2019t time out.`,
    });
}

export function createCantPingCompletedMessageStreamError() {
    return new FailedPreconditionError("The stream has been completed", {
        displayMessage: errorDisplayMessage`Can\u2019t ping a message stream that has been completed.`,
    });
}
