import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {RenderedEmail} from "~/server/emails/internal/templates/email_templates.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export async function processSendEmail(
    context: Context<{tracer: TracerContextModule} & {email: EmailContextModuleBase}>,
    {
        fromEmailAddress,
        toEmailAddress,
        renderedEmail,
    }: {
        fromEmailAddress: string;
        toEmailAddress: string;
        renderedEmail: RenderedEmail;
    },
) {
    return context.tracer.withSpan("Process send email job", async context => {
        await context.email.sendPrerenderedEmailImmediately(
            fromEmailAddress,
            // We trust here that email address has already been validated when the
            // SendEmail job was sent to the queue.
            toEmailAddress as EmailAddress,
            renderedEmail,
        );
    });
}
