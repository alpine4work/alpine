import {EmailAddress} from "~/server/emails/email_address.js";
import {FromEmailAddress} from "~/server/emails/from_email_address.js";
import {EmailTemplates, RenderedEmail} from "~/server/emails/internal/email_templates.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";

/**
 * Context module for sending an email.
 *
 * In production we use [AWS SES][1]. In tests, frequently this is a noop. In
 * development we'd like to have some way to debug email sending.
 *
 * [1]: https://aws.amazon.com/ses/
 */
export abstract class EmailContextModuleBase<
    Modules extends {[key: string]: ContextModuleBase} = {},
> extends ContextModuleBase<Modules> {
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
        fromEmailAddress,
        toEmailAddress,
        templateName,
        templateProps,
    }: {
        fromEmailAddress: FromEmailAddress;
        toEmailAddress: EmailAddress;
        templateName: Template;
        templateProps: Parameters<EmailTemplates[Template]>[0];
    }) {
        const {emailTemplates} = await import("~/server/emails/internal/email_templates.js");
        const renderedEmail = emailTemplates[templateName](templateProps);

        await this._send(fromEmailAddress, toEmailAddress, renderedEmail);
    }

    protected abstract _send(
        fromEmailAddress: FromEmailAddress,
        toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void>;
}
