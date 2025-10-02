import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {RenderedEmail} from "~/server/emails/internal/templates/email_templates.js";
import {DataLossError} from "~/shared/error/error.js";

/**
 * Renders emails, but creates a trace on send instead of sending the email. Throws an error
 * if this context module is used in production to send an email.
 * Useful for staging and local development.
 */
export class TraceOnlyEmailContextModule extends EmailContextModuleBase {
    protected async _send(
        fromEmailAddress: string,
        _toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `TraceOnlyEmailContextModule` in production.");
        return this._context.tracer.withSpan("Console SendEmail", async (context, span) => {
            span.addData({
                email: {
                    template: email.templateName,
                    source: fromEmailAddress,
                },
            });
        });
    }

    public fork() {
        return new TraceOnlyEmailContextModule();
    }
}
