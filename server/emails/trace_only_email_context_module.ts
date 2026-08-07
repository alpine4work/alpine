import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {NonTransactionalEmailType} from "~/server/emails/email_type.js";
import {RenderedEmail} from "~/server/emails/internal/templates/email_templates.js";
import {DataLossError} from "~/shared/error/error.open_source.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Renders emails, but creates a trace on send instead of sending the email. Throws
 * an error if this context module is used in production to send an email. Useful
 * for staging and local development.
 */
export class TraceOnlyEmailContextModule extends EmailContextModuleBase {
    protected async _send(
        fromEmailAddress: string,
        _toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can\u2019t use `TraceOnlyEmailContextModule` in production.");
        return await this._context.tracer.withSpan("Console SendEmail", async (context, span) => {
            span.addData({
                email: {
                    template: email.templateName,
                    source: fromEmailAddress,
                },
            });
        });
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
        return this._serializeUnsubscribeUrl({accountId, spaceId, emailType, baseUrl});
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected async _verifySignedUnsubscribeUrl(_url: URL): Promise<void> {
        // No-op
    }

    public fork() {
        return new TraceOnlyEmailContextModule();
    }
}
