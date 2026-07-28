import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {ErrorBase} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * Prints an error to a Markdown string to be returned to an agent. Uses the
 * `displayMessage` on the error when available.
 *
 * We assume that `displayMessage` is a valid Markdown formatted string without
 * newlines. Code markdown formatting is quite common in `displayMessage`s in
 * `server/agents/web`. Functions like `quote()` and `curlyQuote()` make sure to
 * properly escape their inputs so the resulting string is valid Markdown.
 */
export function printAgentWebError(title: string, error: unknown): string {
    let displayMessages: Array<ErrorDisplayMessage> = [];

    if (!(error instanceof AggregateError)) {
        if (error instanceof ErrorBase && error.displayMessage !== undefined) {
            displayMessages.push(error.displayMessage);
        }
    } else {
        // If we have an `AggregateError` and all errors in the `AggregateError` have a
        // `displayMessage` then we will render all of the errors in a list.
        for (const childError of error.errors) {
            if (childError instanceof ErrorBase && childError.displayMessage !== undefined) {
                displayMessages.push(childError.displayMessage);
            } else {
                // If there's even one error without a `displayMessage` then treat the error as an
                // unknown internal error.
                displayMessages = [];
                break;
            }
        }
    }

    let markdown = "";
    let internalErrorMessage: string | null = null;

    if (displayMessages.length === 1) {
        markdown = `Error: ${title.length > 0 ? `${title}. ` : ""}${printErrorDisplayMessage(displayMessages[0]!)}`;

        // API errors include their server stack in non-production environments. Preserve
        // the internal message when the API could only return the generic display message
        // so agents still get an actionable explanation.
        if (
            error instanceof ErrorBase &&
            printErrorDisplayMessage(displayMessages[0]!) ===
                printErrorDisplayMessage(defaultErrorDisplayMessage) &&
            isObject(error.cause) &&
            isObject(error.cause.error) &&
            typeof error.cause.error.stack === "string"
        ) {
            const stackFirstLine = error.cause.error.stack.split("\n", 1)[0]!;
            internalErrorMessage = stackFirstLine.replace(/^[^:\n]*Error: /, "");
        }
    } else if (displayMessages.length > 0) {
        markdown = `Error: ${title.length > 0 ? `${title}. ` : ""}(${displayMessages.length} errors)\n\n`;
        markdown += displayMessages
            .map(displayMessage => `- ${printErrorDisplayMessage(displayMessage)}`)
            .join("\n\n");
    } else {
        markdown = `Error: ${title.length > 0 ? `${title}. ` : ""}${printErrorDisplayMessage(defaultErrorDisplayMessage)}`;

        // If this is an error without a display message, then include the raw error
        // message so we don't show just a generic "Unexpected error" message. An agent web
        // user (either developer or agent) is technical and so some potentially confusing
        // information is better than no information.
        if (error instanceof Error) internalErrorMessage = error.message;
    }

    if (internalErrorMessage !== null) {
        // Escape special characters like `\n`.
        internalErrorMessage = JSON.stringify(internalErrorMessage).slice(1, -1);

        // Escape markdown formatting characters like `**foo**` and what not.
        internalErrorMessage = printMarkdownTree({
            type: "paragraph",
            children: [{type: "text", value: internalErrorMessage}],
        }).trim();

        markdown += `\n\n> Internal error: ${internalErrorMessage}`;
    }

    return printMarkdownTree(parseMarkdownTree(markdown)).trimEnd();
}

function printErrorDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let markdown = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
                markdown += segment.text;
                break;
            case "SensitiveText":
                markdown += segment.text;
                break;
            case "Link":
                // We don't include links in the markdown, just the text. We add links for humans
                // in a web browser. They aren't designed for agents.
                markdown += segment.text;
                break;
            default:
                throw exhaustive(segment);
        }
    }

    return markdown;
}
