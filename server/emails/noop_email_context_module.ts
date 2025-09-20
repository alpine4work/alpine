/* eslint-disable @typescript-eslint/no-unused-vars */
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {FromEmailAddressAlias} from "~/server/emails/from_email_address.js";
import {EmailTemplates, RenderedEmail} from "~/server/emails/internal/email_templates.js";
import {DataLossError} from "~/shared/error/error.js";

/**
 * No-ops all email rendering and sending.
 * Only to be used outside of production when we don't actually care at all about emails.
 */
export class NoopEmailContextModule extends EmailContextModuleBase {
    public override async send<Template extends keyof EmailTemplates>({
        fromEmailAddressAlias,
        toEmailAddress,
        templateName,
        templateProps,
    }: {
        fromEmailAddressAlias: FromEmailAddressAlias;
        toEmailAddress: EmailAddress;
        templateName: Template;
        templateProps: Parameters<EmailTemplates[Template]>[0];
    }): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `NoopEmailContextModule` in production");
    }

    public override async sendImmediately<Template extends keyof EmailTemplates>({
        fromEmailAddressAlias,
        toEmailAddress,
        templateName,
        templateProps,
    }: {
        fromEmailAddressAlias: FromEmailAddressAlias;
        toEmailAddress: EmailAddress;
        templateName: Template;
        templateProps: Parameters<EmailTemplates[Template]>[0];
    }): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `NoopEmailContextModule` in production");
    }
    protected async _send(
        _fromEmailAddress: string,
        _toEmailAddress: EmailAddress,
        _email: RenderedEmail,
    ): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `NoopEmailContextModule` in production");
    }

    public fork() {
        return new NoopEmailContextModule();
    }
}
