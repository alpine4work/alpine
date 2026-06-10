import {EmailAddress} from "~/shared/helpers/string/email_address.js";

export type EmailMessage = {
    readonly to: ReadonlyArray<EmailAddress>;
    readonly from: EmailAddress;
    readonly cc?: ReadonlyArray<EmailAddress>;
    readonly bcc?: ReadonlyArray<EmailAddress>;
    readonly replyTo?: ReadonlyArray<EmailAddress>;
    readonly subject: string;
    readonly body: {
        readonly text: string;
        readonly html?: string;
    };
    readonly headers: ReadonlyArray<{readonly name: string; readonly value: string}>;
    readonly attachments: ReadonlyArray<{
        readonly filename: string;
        readonly content: Readonly<Uint8Array>;
        readonly contentType: string;
        readonly size: number;
    }>;
};
