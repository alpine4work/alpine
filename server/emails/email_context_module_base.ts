import {EmailAddress} from "~/server/emails/email_address.js";
import {FromEmailAddressAlias} from "~/server/emails/from_email_address.js";
import {EmailTemplates, RenderedEmail} from "~/server/emails/internal/email_templates.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Context module for sending an email.
 *
 * In production we use [AWS SES][1]. In tests, frequently this is a noop. In
 * development we'd like to have some way to debug email sending.
 *
 * [1]: https://aws.amazon.com/ses/
 */
export abstract class EmailContextModuleBase<
        Modules extends {tracer: TracerContextModule} = {tracer: TracerContextModule},
    >
    extends ContextModuleBase<Modules>
    implements ForkableContextModuleBase
{
    /**
     * Sends an email. In production uses the AWS SES [`SendEmail`][1] command.
     *
     * Implements the following AWS SES [best practices][2]:
     *
     * - From email address is carefully curated by the `FromEmailAddress` type to
     *   avoid damaging overall domain reputation.
     * - Forces the caller to have checked that MX DNS records exist with the
     *   `EmailAddress` type.
     *
     * [1]: https://docs.aws.amazon.com/ses/latest/APIReference/API_SendEmail.html
     * [2]: https://docs.aws.amazon.com/ses/latest/dg/tips-and-best-practices.html
     */
    public async send<Template extends keyof EmailTemplates>({
        fromEmailAddressAlias,
        toEmailAddress,
        templateName,
        templateProps,
    }: {
        fromEmailAddressAlias: FromEmailAddressAlias;
        toEmailAddress: EmailAddress;
        templateName: Template;
        templateProps: Parameters<EmailTemplates[Template]>[0];
    }) {
        const renderedEmail = await this._context.tracer.withSpan(
            "React email render",
            async () => {
                const {emailTemplates} = await import(
                    "~/server/emails/internal/email_templates.js"
                );
                return emailTemplates[templateName](templateProps);
            },
        );

        await this._send(fromEmailAddressAlias, toEmailAddress, renderedEmail);
    }

    protected abstract _send(
        fromEmailAddressAlias: FromEmailAddressAlias,
        toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void>;

    public abstract fork(): EmailContextModuleBase;
}
