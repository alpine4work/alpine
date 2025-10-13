import {EmailAddress} from "~/server/emails/email_address.js";
import {
    NonTransactionalEmailType,
    isNonTransactionalEmailType,
} from "~/server/emails/email_type.js";
import {
    FromEmailAddressAlias,
    getFormattedFromEmailAddress,
} from "~/server/emails/from_email_address.js";
import {
    EmailTemplates,
    RenderedEmail,
    renderReactEmailTemplate,
} from "~/server/emails/internal/templates/email_templates.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Context module for sending an email.
 *
 * Our email system implements the following AWS SES [best practices][1]:
 *
 * - From email address is carefully curated by the `FromEmailAddress` type to
 *   avoid damaging overall domain reputation.
 * - Forces the caller to have checked that MX DNS records exist with the
 *   `EmailAddress` type.
 *
 * [1]: https://docs.aws.amazon.com/ses/latest/dg/tips-and-best-practices.html
 */
export abstract class EmailContextModuleBase<
        Modules extends {tracer: TracerContextModule; jobs: JobsContextModule} = {
            tracer: TracerContextModule;
            jobs: JobsContextModule;
        },
    >
    extends ContextModuleBase<Modules>
    implements ForkableContextModuleBase
{
    /**
     * Sends an email via the job queue.
     * If it's critical that your email is sent immediately,
     * use `sendImmediately` instead, which will skip the job queue.
     * Note that the job queue only guarantees at least once delivery,
     * so, rarely, an email may be sent multiple times
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
        const renderedEmail = await renderReactEmailTemplate(this._context.tracer, {
            templateName,
            templateProps,
        });
        const fromEmailAddress = getFormattedFromEmailAddress(
            FromEmailAddressAlias[fromEmailAddressAlias],
            "name-addr",
        );
        await this._context.jobs.dangerouslySendMaintenance({
            type: "SendEmail",
            fromEmailAddress,
            toEmailAddress,
            renderedEmail,
        });
    }
    /**
     * Sends an email immediately without the job queue.
     * Use this if it's important your email is sent right away or you wish to handle errors and
     * retries yourself.
     */
    public async sendImmediately<Template extends keyof EmailTemplates>({
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
        const renderedEmail = await renderReactEmailTemplate(this._context.tracer, {
            templateName,
            templateProps,
        });
        const fromEmailAddress = getFormattedFromEmailAddress(
            FromEmailAddressAlias[fromEmailAddressAlias],
            "name-addr",
        );
        await this._send(fromEmailAddress, toEmailAddress, renderedEmail);
    }
    /**
     * Accepts an already rendered email body and from email address and sends it without the job queue.
     * Intended only for processing send email jobs from within queue consumers.
     * You should use `send` or `sendImmediately` instead which render a template for you.
     */
    public async sendPrerenderedEmailImmediately(
        fromEmailAddress: string,
        toEmailAddress: EmailAddress,
        renderedEmail: RenderedEmail,
    ): Promise<void> {
        await this._send(fromEmailAddress, toEmailAddress, renderedEmail);
    }

    protected _serializeUnsubscribeUrl({
        accountId,
        spaceId,
        emailType,
        baseUrl,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
        emailType: NonTransactionalEmailType;
        baseUrl: string;
    }): URL {
        return new URL(
            `${baseUrl}/s/${spaceId}/notifications/unsubscribe?accountId=${accountId}&emailType=${emailType}`,
        );
    }

    protected _deserializeUnsubscribeUrl(url: URL): {
        accountId: AccountId;
        spaceId: SpaceId;
        emailType: NonTransactionalEmailType;
    } {
        const spaceId = url.pathname.split("/")[2];
        const accountId = url.searchParams.get("accountId");
        const emailType = url.searchParams.get("emailType");

        assert(
            accountId &&
                spaceId &&
                emailType &&
                isId<AccountId>(accountId) &&
                isId<SpaceId>(spaceId) &&
                isNonTransactionalEmailType(emailType),
            "Invalid unsubscribe URL",
        );
        return {
            accountId: accountId,
            spaceId: spaceId,
            emailType: emailType,
        };
    }

    public async getPartsFromSignedUnsubscribeUrl(url: URL): Promise<{
        accountId: AccountId;
        spaceId: SpaceId;
        emailType: NonTransactionalEmailType;
    }> {
        await this._verifySignedUnsubscribeUrl(url);
        const {accountId, spaceId, emailType} = this._deserializeUnsubscribeUrl(url);
        return {accountId, spaceId, emailType};
    }

    /**
     * Get a signed URL to unsubscribe from an email segment intended to be used by AppService.
     */
    public abstract getSignedUnsubscribeUrlForAppService({
        accountId,
        spaceId,
        emailType,
        baseUrl,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
        emailType: NonTransactionalEmailType;
        baseUrl: string;
    }): Promise<URL>;

    protected abstract _verifySignedUnsubscribeUrl(url: URL): Promise<void>;

    protected abstract _send(
        fromEmailAddress: string,
        toEmailAddress: EmailAddress,
        email: RenderedEmail,
    ): Promise<void>;

    public abstract fork(): EmailContextModuleBase;
}
