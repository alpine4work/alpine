import {assert} from "~/shared/helpers/control/assert";
import {isObject} from "~/shared/helpers/object/is_object";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * Error message which we will show to a user. Must be constructed with the
 * `errorDisplayMessage` template function.
 */
export type ErrorDisplayMessage = SchemaType<typeof _ErrorDisplayMessageSchema> & {
    // Make this a nominal type to force developers to construct an
    // `ErrorDisplayMessage` with `errorDisplayMessage()`.
    readonly _ErrorDisplayMessage: never;
};

export type ErrorDisplayMessageSegment = SchemaType<typeof ErrorDisplayMessageSegmentSchema>;

export type ErrorDisplayMessageLinkSegment = SchemaType<
    typeof ErrorDisplayMessageLinkSegmentSchema
>;

export const ErrorDisplayMessageLinkSegmentSchema = Schema.object({
    type: Schema.value("Link"),
    text: Schema.string,
    url: Schema.string,
});

export const ErrorDisplayMessageSegmentSchema = Schema.union({
    Text: Schema.object({
        type: Schema.value("Text"),
        text: Schema.string,
    }),
    SensitiveText: Schema.object({
        type: Schema.value("SensitiveText"),
        text: Schema.string,
    }),
    Link: ErrorDisplayMessageLinkSegmentSchema,
});

const _ErrorDisplayMessageSchema = Schema.array(ErrorDisplayMessageSegmentSchema);

export const ErrorDisplayMessageSchema: Schema<ErrorDisplayMessage> =
    _ErrorDisplayMessageSchema as Schema<any>;

/**
 * Error messages are intended for developers, not for users. Error messages
 * that are intended for user display use this `ErrorDisplayMessage` type.
 *
 * The `ErrorDisplayMessage` type:
 *
 * - Provides some formatting options like the ability to include links.
 * - Automatically hides sensitive text from logging.
 *
 * We use the Adobe Spectrum content guidelines for [writing error
 * messages][1]. If you are writing a new error message then please consult
 * these guidelines!
 *
 * Your display message should be "the underlying cause" and "how to fix it"
 * parts of an error message (as specified by Adobe Spectrum). The UI which
 * presents your error to the user is responsible for the "what happened" part.
 *
 * [1]: https://spectrum.adobe.com/page/writing-for-errors
 */
export function errorDisplayMessage(
    templateStrings: TemplateStringsArray,
    ...values: Array<string | number | ErrorDisplayMessageLinkSegment>
): ErrorDisplayMessage {
    assert(templateStrings.length > 0);
    assert(templateStrings.length === values.length + 1);

    const message: Array<ErrorDisplayMessageSegment> = [];

    for (let i = 0; i < templateStrings.length; i++) {
        if (i !== 0) {
            const value = values[i - 1]!;

            if (isObject(value)) {
                message.push(value);
            } else {
                // Interpolated values are all considered to be sensitive user data. Create a
                // new error message with `errorDisplayMessage()` if you don't want some text
                // to be marked as sensitive.
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
