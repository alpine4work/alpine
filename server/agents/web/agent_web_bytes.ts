import prettyBytes from "pretty-bytes";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

/**
 * Prints a byte count to a string for use by agents.
 */
export function printAgentWebBytes(number: number): string {
    return prettyBytes(number, {space: false}).toLowerCase();
}

/**
 * Parses a byte count from a string back to a number for use by agents.
 */
export function parseAgentWebBytes(string: string): number {
    const match = string
        .trim()
        .toLowerCase()
        .match(/^([0-9]+(?:\.[0-9]+)? *([kmg]?b))$/);
    if (!match) {
        throw new InvalidArgumentError("Unexpected format for bytes", {
            displayMessage: createErrorDisplayMessage(string),
        });
    }

    const number = parseFloat(match[1]!);
    if (isNaN(number) || !Number.isFinite(number)) {
        throw new InvalidArgumentError("Number is NaN or infinite", {
            displayMessage: createErrorDisplayMessage(string),
        });
    }

    const unit = match[2]!;

    switch (unit) {
        case "b":
            return number;
        case "kb":
            return number * 10 ** 3;
        case "mb":
            return number * 10 ** 6;
        case "gb":
            return number * 10 ** 9;
        default:
            throw new InvalidArgumentError("Unexpected unit for bytes", {
                displayMessage: createErrorDisplayMessage(string),
            });
    }
}

function createErrorDisplayMessage(string: string) {
    return errorDisplayMessage`Couldn\u2019t parse byte count from: ${curlyQuote(string)}. Byte count must be formatted as a number followed by a unit (e.g. 2.4kb) where the acceptable units are \u201Cb\u201D (bytes), \u201Ckb\u201D (kilobytes), \u201Cmb\u201D (megabytes), or \u201Cgb\u201D (gigabytes).`;
}
