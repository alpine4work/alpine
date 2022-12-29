/**
 * Error message which we will show to a user. Must be constructed with the
 * `errorDisplayMessage` template function.
 */
export type ErrorDisplayMessage = ReadonlyArray<ErrorDisplayMessageSegment> & {
    // Make this a nominal type to force developers to construct an
    // `ErrorDisplayMessage` with `errorDisplayMessage()`.
    readonly _ErrorDisplayMessage: never;
};

export type ErrorDisplayMessageSegment =
    | ErrorDisplayMessageTextSegment
    | ErrorDisplayMessageSensitiveTextSegment
    | ErrorDisplayMessageLinkSegment;

export type ErrorDisplayMessageTextSegment = {
    readonly type: "Text";
    readonly text: string;
};

export type ErrorDisplayMessageSensitiveTextSegment = {
    readonly type: "SensitiveText";
    readonly text: string;
};

export type ErrorDisplayMessageLinkSegment = {
    readonly type: "Link";
    readonly text: string;
    readonly url: string;
};
