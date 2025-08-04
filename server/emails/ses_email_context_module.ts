// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// `aws4fetch` for executing any AWS commands.
import type * as types from "@aws-sdk/client-ses";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {encodeAwsUrlencodedFormat} from "~/server/emails/encode_aws_urlencoded_format.js";
import {
    FromEmailAddress,
    getFromEmailAddress,
    getFromEmailAddressName,
} from "~/server/emails/from_email_address.js";
import {RenderedEmail} from "~/server/emails/internal/email_templates.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {UnknownError} from "~/shared/error/error.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Send an email with AWS SES. Used in production to send emails.
 */
// NOTE(calebmer): This class used to run in Cloudflare Workers where we can't
// use the AWS SDK which is why we're using `AwsRequestSigner` directly.
// Eventually this should probably migrate to `@aws-sdk/client-ses`.
export class SesEmailContextModule extends EmailContextModuleBase {
    private readonly _url: string;
    private readonly _signer: AwsRequestSigner;

    constructor(url: string, signer: AwsRequestSigner) {
        super();
        this._url = url;
        this._signer = signer;
    }

    protected _send(
        fromEmailAddress: FromEmailAddress,
        toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void> {
        return this._context.tracer.withSpan("SES SendEmail", async (context, span) => {
            const actualFromEmailAddress = getFromEmailAddress(fromEmailAddress);
            const fromEmailAddressName = getFromEmailAddressName(fromEmailAddress);

            span.addData({
                email: {
                    template: email.templateName,
                },
                aws: {
                    ses: {
                        source: actualFromEmailAddress,
                    },
                },
            });

            const output = await executeSesSendEmailCommand(span, this._url, this._signer, {
                // eslint-disable-next-line string-quotes
                Source: `"${fromEmailAddressName}" <${actualFromEmailAddress}>`,
                Destination: {ToAddresses: [toEmailAddress]},
                Message: {
                    Subject: {Charset: "utf8", Data: email.getHtmlTitle()},
                    Body: {Html: {Charset: "utf8", Data: email.html}},
                },
            });

            span.addData({
                aws: {
                    ses: {
                        messageId: output.MessageId,
                    },
                },
            });
        });
    }

    public fork() {
        return new SesEmailContextModule(this._url, this._signer);
    }
}

async function executeSesSendEmailCommand(
    span: TracerSpan,
    url: string,
    signer: AwsRequestSigner,
    input: types.SendEmailCommandInput,
): Promise<types.SendEmailCommandOutput> {
    let request = new Request(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: encodeAwsUrlencodedFormat({
            Action: "SendEmail",
            Version: "2010-12-01",
            ...input,
        } as any),
    });

    request = await signer.sign(request, span);

    // We already have a span so we don't need `fetchWithTracer()`.
    // eslint-disable-next-line no-global-fetch
    const response = await fetch(request);

    const body: any = await response.json();
    const output = body.SendEmailResponse?.SendEmailResult;

    if (response.status !== 200 || !output?.MessageId) {
        const code = body.Error?.Code;
        const message = body.Error?.Message;
        throw new UnknownError(`SES ${code ?? "unknown error"}${message ? `: ${message}` : ""}`, {
            cause: body,
        });
    }

    return output;
}
