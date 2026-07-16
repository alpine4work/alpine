import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

// NOTE(ifitzsimmons, 2026-07-09): The error messages here have display messages so
// that our API clients can display more helpful error messages to users.

export function createMessageApprovalNotFoundError() {
    return new NotFoundError("Approval request not found", {
        displayMessage: errorDisplayMessage`Approval request not found.`,
    });
}

export function createMessageApprovalAlreadyDecidedError() {
    return new FailedPreconditionError("Approval request has already been decided", {
        displayMessage: errorDisplayMessage`Approval request has already been decided.`,
    });
}

export function createMessageApprovalRequiresMessageStreamError() {
    return new FailedPreconditionError("Message approvals can only be sent with message streams", {
        displayMessage: errorDisplayMessage`Message approvals can only be sent with message streams.`,
    });
}
