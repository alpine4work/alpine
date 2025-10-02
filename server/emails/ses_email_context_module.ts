import {SESClient, SESServiceException, SendEmailCommand} from "@aws-sdk/client-ses";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {RenderedEmail} from "~/server/emails/internal/templates/email_templates.js";
import {InternalError, UnavailableError} from "~/shared/error/error.js";

/**
 * Send an email with AWS SES. Used in production to send emails.
 */
export class SesEmailContextModule extends EmailContextModuleBase {
    private readonly _client: SESClient;

    constructor() {
        super();
        this._client = new SESClient({region: "us-east-1"});
    }

    protected _send(
        fromEmailAddress: string,
        toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void> {
        return this._context.tracer.withSpan("SES SendEmail", async (context, span) => {
            span.addData({
                email: {
                    template: email.templateName,
                    source: fromEmailAddress,
                },
            });

            const input = {
                Source: fromEmailAddress,
                Destination: {ToAddresses: [toEmailAddress]},
                Message: {
                    Subject: {Charset: "utf8", Data: email.title},
                    Body: {Html: {Charset: "utf8", Data: email.html}},
                },
            };

            try {
                const output = await this._client.send(new SendEmailCommand(input));
                span.addData({
                    aws: {
                        ses: {
                            messageId: output.MessageId,
                        },
                    },
                });
            } catch (error) {
                if (!SESServiceException.isInstance(error)) throw error;

                // ServiceUnavailable errors are expected to be transient and are retryable
                if (error.name === "ServiceUnavailable" || error.$retryable) {
                    throw UnavailableError.from(error, "SES SendEmail failed");
                }
                // These errors are not recoverable and indicate an invalid input payload or an
                // AWS account or configuration issue
                throw InternalError.from(error, "SES SendEmail failed");
            }
        });
    }

    public fork() {
        return new SesEmailContextModule();
    }
}
