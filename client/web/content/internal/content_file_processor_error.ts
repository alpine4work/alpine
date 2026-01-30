import {withoutErrorDisplayMessageRendererReporting} from "~/client/web/design/without_error_display_message_renderer_reporting.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * An error class representing a `FileProcessorError`. Generates a display
 * message for the user.
 */
export class ContentFileProcessorError
    // We need to extend a non-system error. We pick `InvalidArgumentError` for
    // this as it represents the user uploading an invalid file.
    extends InvalidArgumentError
{
    public readonly title: string;
    public override readonly displayMessage: ErrorDisplayMessage;
    public override readonly cause: FileProcessorError;

    // If this error is rendered by `<ErrorDisplayMessageRenderer>` we don't want
    // it reported to our tracer. Since the error was generated, possibly a long
    // time ago, by `FileProcessorService` and now the file permanently lives in an
    // error state.
    public readonly [withoutErrorDisplayMessageRendererReporting] = true;

    constructor(contentType: FileContentType, error: FileProcessorError) {
        let title: string;
        let displayMessage: ErrorDisplayMessage;

        switch (error.type) {
            case "Unknown": {
                const noun = getFileContentTypeNoun(contentType);

                title = `Couldn\u2019t open ${noun}`;
                displayMessage = errorDisplayMessage`The ${noun} may be corrupted. Try downloading the ${noun} and opening it in another application.`;
                break;
            }
            case "PasswordProtected": {
                const noun = getFileContentTypeNoun(contentType);

                title = `Protected ${noun}`;
                displayMessage = errorDisplayMessage`A password is required to open this ${noun}. Try opening the ${noun} and entering the password.`;
                break;
            }
            default:
                throw exhaustive(error);
        }

        super("Couldn\u2019t process file", {
            displayMessage,
            cause: error,
        });

        this.title = title;
        this.displayMessage = displayMessage;
        this.cause = error;
    }
}
