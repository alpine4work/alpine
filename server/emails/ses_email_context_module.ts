import {SESClient, SESServiceException, SendEmailCommand} from "@aws-sdk/client-ses";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {NonTransactionalEmailType} from "~/server/emails/email_type.js";
import {RenderedEmail} from "~/server/emails/internal/templates/email_templates.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {InternalError, InvalidArgumentError, UnavailableError} from "~/shared/error/error.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Send an email with AWS SES. Used in production to send emails.
 */
export class SesEmailContextModule extends EmailContextModuleBase {
    private readonly _client: SESClient;
    private readonly _tokenAgent: TokenAgent;

    constructor(tokenAgent: TokenAgent) {
        super();
        this._tokenAgent = tokenAgent;
        this._client = new SESClient({region: "us-east-1"});
    }

    public async getSignedUnsubscribeUrlForAppService({
        accountId,
        spaceId,
        emailType,
        baseUrl,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
        emailType: NonTransactionalEmailType;
        baseUrl: string;
    }): Promise<URL> {
        return this._tokenAgent.privateSide.dangerouslySignUrl(
            "AppService",
            this._serializeUnsubscribeUrl({accountId, spaceId, emailType, baseUrl}),
            // Unsubscribe URLs are valid for 30 days
            {expirationMinutes: 60 * 24 * 30},
        );
    }

    protected async _verifySignedUnsubscribeUrl(url: URL): Promise<void> {
        try {
            await this._tokenAgent.publicSide.verifyUrl(url);
        } catch {
            throw new InvalidArgumentError("Invalid or expired email unsubscribe link");
        }
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
                ConfigurationSetName: "ProductionAlpine",
                Message: {
                    Subject: {Charset: "utf8", Data: email.title},
                    Body: {
                        Html: {Charset: "utf8", Data: email.html},
                        Text: {Charset: "utf8", Data: email.plainText},
                    },
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
        return new SesEmailContextModule(this._tokenAgent);
    }
}
