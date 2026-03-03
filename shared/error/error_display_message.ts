import {InternalError} from "~/shared/error/error.js";
import {
    ErrorDisplayMessage,
    ErrorDisplayMessageLinkSegment,
    ErrorDisplayMessageSegment,
} from "~/shared/error/types/error_display_message_type.js";

/**
 * Error messages are intended for developers, not for users. Error messages that
 * are intended for user display use this `ErrorDisplayMessage` type.
 *
 * The `ErrorDisplayMessage` type:
 *
 * - Provides some formatting options like the ability to include links.
 * - Automatically hides sensitive text from logging.
 *
 * We use the Adobe Spectrum content guidelines for [writing error messages][1]. If
 * you are writing a new error message then please consult these guidelines!
 *
 * Your display message should be "the underlying cause" and "how to fix it" parts
 * of an error message (as specified by Adobe Spectrum). The UI which presents your
 * error to the user is responsible for the "what happened" part.
 *
 * [1]: https://spectrum.adobe.com/page/writing-for-errors
 */
export function errorDisplayMessage(
    templateStrings: ReadonlyArray<string>,
    ...values: Array<string | number | ErrorDisplayMessageLinkSegment | ErrorDisplayMessage>
): ErrorDisplayMessage {
    if (templateStrings.length === 0)
        throw new InternalError("Template string array must not be empty");
    if (templateStrings.length !== values.length + 1)
        throw new InternalError("Must have appropriate number of values for template string array");

    const message: Array<ErrorDisplayMessageSegment> = [];

    for (let i = 0; i < templateStrings.length; i++) {
        if (i !== 0) {
            const value = values[i - 1]!;

            if (isErrorDisplayMessage(value)) {
                for (const segment of value) {
                    message.push(segment);
                }
            } else if (isErrorDisplayMessageLinkSegment(value)) {
                message.push(value);
            } else {
                // Interpolated values are all considered to be sensitive user data. Create a new
                // error message with `errorDisplayMessage()` if you don't want some text to be
                // marked as sensitive.
                message.push({
                    type: "SensitiveText",
                    text: typeof value === "number" ? String(value) : value,
                });
            }
        }

        const text = templateStrings[i]!;
        if (text.length > 0) {
            message.push({type: "Text", text});
        }
    }

    return message as any as ErrorDisplayMessage;
}

function isErrorDisplayMessage(
    value: string | number | ErrorDisplayMessageLinkSegment | ErrorDisplayMessage,
): value is ErrorDisplayMessage {
    return Array.isArray(value);
}

function isErrorDisplayMessageLinkSegment(
    value: string | number | ErrorDisplayMessageLinkSegment | ErrorDisplayMessage,
): value is ErrorDisplayMessageLinkSegment {
    return typeof value === "object" && value !== null && (value as any).type === "Link";
}

/**
 * Creates a link segment for an error display message.
 *
 * Do not include sensitive user content in this segment! We assume `text` and
 * `url` are not sensitive and may include them in logging.
 */
errorDisplayMessage.link = (text: string, url: string): ErrorDisplayMessageLinkSegment => ({
    type: "Link",
    text,
    url,
});

// TODO(calebmer): Replace this with an actual email address when we have a real
// domain name.
const supportEmailAddress = "support@alpine.inc";

const supportLink = errorDisplayMessage.link(supportEmailAddress, `mailto:${supportEmailAddress}`);

/**
 * A link to our support email address.
 */
errorDisplayMessage.supportLink = supportLink;

/**
 * A sign in link. Sign in links in error messages add `?to` to the URL so once the
 * user finishes signing in we navigate them to the route they were trying to
 * access.
 */
function signInLink(text: string) {
    return errorDisplayMessage.link(text, signInLink.url);
}

// Can't import `shared/helpers` from this file so inline the `cast()` function
// here.
function cast<Type>(value: Type): Type {
    return value;
}

signInLink.url = "/auth/sign-in";

errorDisplayMessage.signInLink = cast<
    ((text: string) => ErrorDisplayMessageLinkSegment) & {readonly url: string}
>(signInLink);

/**
 * A sign out link. Sign out links in error messages get special handling so they
 * actually sign the account out in our native mobile app. Instead of opening the
 * link in the mobile browser which is the default for links in our native mobile
 * app.
 */
function signOutLink(text: string) {
    return errorDisplayMessage.link(text, signOutLink.url);
}

signOutLink.url = "/sign-out";

errorDisplayMessage.signOutLink = cast<
    ((text: string) => ErrorDisplayMessageLinkSegment) & {readonly url: string}
>(signOutLink);

/**
 * A space switcher link. Space switcher links in error messages get special
 * handling so they open the switch space route in our native mobile app. Instead
 * of opening the link in the mobile web browser which is the default for links in
 * our native mobile app.
 */
function switchSpaceLink(text: string) {
    return errorDisplayMessage.link(text, switchSpaceLink.url);
}

switchSpaceLink.url = "/switch-space";

errorDisplayMessage.switchSpaceLink = cast<
    ((text: string) => ErrorDisplayMessageLinkSegment) & {readonly url: string}
>(switchSpaceLink);
