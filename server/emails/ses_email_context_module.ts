// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// `aws4fetch` for executing any AWS commands.
import type * as types from "@aws-sdk/client-ses";
import {AwsClient} from "aws4fetch";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {encodeAwsUrlencodedFormat} from "~/server/emails/encode_aws_urlencoded_format.js";
import {
    FromEmailAddress,
    getFromEmailAddress,
    getFromEmailAddressName,
} from "~/server/emails/from_email_address.js";
import {RenderedEmail} from "~/server/emails/internal/email_templates.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";

/**
 * Send an email with AWS SES. Used in production to send emails.
 */
export class SesEmailContextModule extends EmailContextModuleBase<{tracer: TracerContextModule}> {
    // TODO(calebmer): When this code was written, all server code ran on
    // Cloudflare Workers which could not run the AWS SDK. Now that this module
    // only runs on Node.js we should switch to using the AWS SDK SES client.
    private readonly _awsHttpClient: AwsClient;

    constructor(awsHttpClient: AwsClient) {
        super();
        this._awsHttpClient = awsHttpClient;
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

            const output = await executeSesSendEmailCommand(this._awsHttpClient, {
                Source: `"${fromEmailAddressName}" <${actualFromEmailAddress}>`,
                Destination: {ToAddresses: [toEmailAddress]},
                Message: {
                    Subject: {Charset: "utf8", Data: email.getHtmlTitle()},
                    Body: {Html: {Charset: "utf8", Data: email.html}},
                },
                ReturnPath: "email-errors@cyberworlds.dev",
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
}

async function executeSesSendEmailCommand(
    client: AwsClient,
    input: types.SendEmailCommandInput,
): Promise<types.SendEmailCommandOutput> {
    const response = await client.fetch("https://email.us-east-1.amazonaws.com", {
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
