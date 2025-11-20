import {messageStreamTimeoutServerLimitMs} from "~/server/messaging/helpers/has_message_stream_timed_out_on_server.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

const timeoutInSeconds = messageStreamTimeoutServerLimitMs / 1000;

export function createCantCompleteStaleMessageStreamError() {
    return new FailedPreconditionError("The stream has timed out", {
        displayMessage: errorDisplayMessage`Can’t complete a message stream that has timed out after ${timeoutInSeconds} seconds of inactivity. If you have a long running process updating a message stream, then during periods of inactivity occasionally ping the message stream so it doesn’t time out.`,
    });
}

export function createCantWriteToStaleMessageStreamError() {
    return new FailedPreconditionError("The stream has timed out", {
        displayMessage: errorDisplayMessage`Can’t put message part for a message stream that has timed out after ${timeoutInSeconds} seconds of inactivity. If you have a long running process updating a message stream, then during periods of inactivity occasionally ping the message stream so it doesn’t time out.`,
    });
}

export function createCantPingStaleMessageStreamError() {
    return new FailedPreconditionError("The stream has timed out", {
        displayMessage: errorDisplayMessage`Can’t ping a message stream that has timed out after ${timeoutInSeconds} seconds of inactivity. If you have a long running process updating a message stream, then during periods of inactivity occasionally ping the message stream so it doesn’t time out.`,
    });
}

export function createCantPingCompletedMessageStreamError() {
    return new FailedPreconditionError("The stream has been completed", {
        displayMessage: errorDisplayMessage`Can’t ping a message stream that has been completed.`,
    });
}
