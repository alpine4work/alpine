import {toPlainText} from "@react-email/render";
import {decode as decodeHtmlEntities} from "html-entities";
import {ComponentProps} from "react";
import {renderToReadableStream} from "react-dom/server";
import {NotificationDigestEmailTemplate} from "~/server/emails/internal/templates/notification_digest_email_template.js";
import {SignInOrSignUpEmailTemplate} from "~/server/emails/internal/templates/sign_in_or_sign_up_email_template.js";
import {SpaceInviteEmailTemplate} from "~/server/emails/internal/templates/space_invite_email_template.js";
import {TryOnDesktopEmailTemplate} from "~/server/emails/internal/templates/try_on_desktop_email_template.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {waitForReadableStreamString} from "~/shared/helpers/binary/wait_for_readable_stream_string.js";

// To preserve types, we must explicitly set keys and their respective templates / names.
// If we use maps or other iterables, we'll lose prop type validation.
export const emailTemplates = {
    SignInOrSignUp: createEmailTemplate(SignInOrSignUpEmailTemplate, "SignInOrSignUp"),
    SpaceInvite: createEmailTemplate(SpaceInviteEmailTemplate, "SpaceInvite"),
    NotificationDigest: createEmailTemplate(NotificationDigestEmailTemplate, "NotificationDigest"),
    TryOnDesktop: createEmailTemplate(TryOnDesktopEmailTemplate, "TryOnDesktop"),
};

/**
 * The result of rendering an email template.
 */
export type RenderedEmail = {
    /**
     * The name of the template which rendered this email.
     */
    readonly templateName: string;

    /**
     * The HTML content of the email.
     */
    readonly html: string;

    /**
     * The plain text content of the email.
     */
    readonly plainText: string;

    /**
     * Get the title of the HTML email content. You should use the title as the
     * email subject.
     */
    readonly title: string;
};

export type EmailTemplates = typeof emailTemplates;

export type EmailTemplateProps<Template extends keyof EmailTemplates> = Omit<
    Parameters<EmailTemplates[Template]>[0],
    "resourceServiceUrl"
>;

export function getTitleFromHtml(html: string): string {
    // Forgive me for I employ the [dark art][1] of HTML parsing with a regex.
    //
    // I believe it's acceptable here. A `<title>` element should have no
    // attributes and only string contents.
    //
    // We are also parsing HTML generated internally by our codebase. Not by an
    // end-user. So we don't have to deal with weird end-user edge cases. We may
    // find user generated content in the title but it should be properly escaped
    // by React.
    //
    // A regex here is simple and fast to execute. Moving on.
    //
    // [1]: https://blog.codinghorror.com/parsing-html-the-cthulhu-way/
    const match = html.match(/<title>([^<]+)<\/title>/);
    if (!match) return "";
    return decodeHtmlEntities(match[1]!.trim().replace(/\s\s+/g, " "));
}

function createEmailTemplate<T>(Component: React.ComponentType<T>, templateName: string) {
    return async (props: ComponentProps<typeof Component>): Promise<RenderedEmail> => {
        let renderError: {hasError: boolean; error: unknown} | null = null;

        let html = await waitForReadableStreamString(
            await renderToReadableStream(<Component {...(props as any)} />, {
                progressiveChunkSize: Number.POSITIVE_INFINITY,
                onError: error => {
                    renderError = {hasError: true, error};
                },
            }),
        );

        if (renderError) {
            // @ts-expect-error: TypeScript doesn't realize `renderError` can be assigned
            // in the `await`.
            throw renderError.error;
        }

        const doctype =
            // eslint-disable-next-line cyberworlds/string-quotes
            '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

        html = `${doctype}${html.replace(/<!DOCTYPE.*?>/, "")}`;

        const title = getTitleFromHtml(html);
        const plainText = toPlainText(html);

        return {
            templateName,
            html,
            title,
            plainText,
        };
    };
}

export function renderReactEmailTemplate<Template extends keyof EmailTemplates>(
    tracer: TracerContextModule,
    {
        resourceServiceUrl,
        templateName,
        templateProps,
    }: {
        resourceServiceUrl: string;
        templateName: Template;
        templateProps: EmailTemplateProps<Template>;
    },
): Promise<RenderedEmail> {
    return tracer.withSpan("React email render", async () => {
        // TS is already validating templateProps assumes the props from
        // templateName on emailTemplates. Given we don't know which templateName
        // is going to be passed in here, TS has a hard time finding which props
        // it expects here. The usage of this function should validate templateProps'
        // just fine.
        return emailTemplates[templateName]({
            ...templateProps,
            resourceServiceUrl,
        } as any);
    });
}
