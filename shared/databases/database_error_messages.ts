import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export function createDatabaseTableNotFoundError(tableId: string | undefined) {
    return new NotFoundError(`Database table ${tableId ?? ""} not found`, {
        aggregateDedupeKey: tableId,
        displayMessage: errorDisplayMessage`Database not found`,
    });
}
