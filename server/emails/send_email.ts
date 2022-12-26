// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// `context.awsClient` for executing any AWS commands.
import type * as types from "@aws-sdk/client-ses";
import {AwsContextModule} from "~/server/context/aws_context_module";
import {EmailAddress} from "~/server/emails/email_address";
import {FromEmailAddress, getFromEmailAddress} from "~/server/emails/from_email_address";
// IMPORTANT: We only import the type for `emailTemplates` here. We lazily load
// the email code bundle to avoid negatively impacting Cloudflare Worker
// startup times.
import type {EmailTemplates} from "~/server/emails/internal/email_templates";
import {encodeAwsUrlencodedFormat} from "~/server/helpers/aws/encode_aws_urlencoded_format";
import {Context} from "~/shared/context/context";
import {UnknownError} from "~/shared/error/error";

/**
 * Sends an email using the Amazon SES [`SendEmail`][1] command.
 *
 * Implements the following Amazon SES [best practices][2]:
 *
 * - From email address is carefully curated by the `FromEmailAddress` type to
 *   avoid damaging overall domain reputation.
 * - Forces the caller to have checked that MX DNS records exist with the
 *   `EmailAddress` type.
 *
 * [1]: https://docs.aws.amazon.com/ses/latest/APIReference/API_SendEmail.html
 * [2]: https://docs.aws.amazon.com/ses/latest/dg/tips-and-best-practices.html
 */
export async function sendEmail<Template extends keyof EmailTemplates>(
    context: Context<{aws: AwsContextModule}>,
    {
        fromEmailAddress,
        toEmailAddress,
        templateName,
        templateProps,
    }: {
        fromEmailAddress: FromEmailAddress;
        toEmailAddress: EmailAddress;
        templateName: Template;
        templateProps: Parameters<EmailTemplates[Template]>[0];
    },
) {
    const {emailTemplates} = await import("~/server/emails/internal/email_templates");
    const renderedEmail = emailTemplates[templateName](templateProps);

    // Figure out what to do with email in development and test environments.
    // Developers should be able to see all emails sent by the system. Tests should
    // also be able to inspect emails.
    if (process.env.NODE_ENV !== "production") {
        return;
    }

    await executeSesSendEmailCommand(context, {
        Source: getFromEmailAddress(fromEmailAddress),
        Destination: {ToAddresses: [toEmailAddress]},
        Message: {
            Subject: {Charset: "utf8", Data: renderedEmail.getHtmlTitle()},
            Body: {Html: {Charset: "utf8", Data: renderedEmail.html}},
        },
        ReturnPath: "email-errors@cyberworlds.dev",
    });

    // TODO(calebmer): Log message id somewhere
}

async function executeSesSendEmailCommand(
    context: Context<{aws: AwsContextModule}>,
    input: types.SendEmailCommandInput,
): Promise<types.SendEmailCommandOutput> {
    const response = await context.aws.client.fetch("https://email.us-east-1.amazonaws.com", {
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
