import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {RenderedEmail} from "~/server/emails/internal/email_templates.js";
import {DataLossError} from "~/shared/error/error.js";

/**
 * Do nothing when sending an email. This is used in tests. Throws an error if
 * you try to use this context module in production to send an email.
 */
export class NoopEmailContextModule extends EmailContextModuleBase {
    protected async _send(
        fromEmailAddress: string,
        _toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError(
                "Can’t use `NoopEmailContextModule` in production since users won’t get their emails",
            );
        return this._context.tracer.withSpan("No-op SendEmail", async (context, span) => {
            span.addData({
                email: {
                    template: email.templateName,
                    source: fromEmailAddress,
                },
            });
        });
    }

    public fork() {
        return new NoopEmailContextModule();
    }
}
