import {validate as validateEmail} from "email-validator";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

/**
 * A correctly formatted [email address][1].
 */
export type EmailAddress = string & {readonly _EmailAddress: never};

/**
 * Validates that a string is an email address by checking its formatting.
 */
export function validateEmailAddress(emailAddress: string): EmailAddress {
    // Email address is case-insensitive. So normalize email address.
    emailAddress = emailAddress.toLowerCase();

    if (!isEmailAddressValid(emailAddress)) {
        throw new InvalidArgumentError("Expected string to be an email address", {
            displayMessage: errorDisplayMessage`\u201C${emailAddress}\u201D isn\u2019t an email address. Try again with an email address like \u201Cname@company.com\u201D.`,
        });
    }

    return emailAddress;
}

/**
 * Validate that a string is formatted as an email address.
 */
export function isEmailAddressValid(emailAddress: string): emailAddress is EmailAddress {
    return emailAddress === emailAddress.toLowerCase() && validateEmail(emailAddress);
}
