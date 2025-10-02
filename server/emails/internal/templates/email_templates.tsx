import {render} from "@react-email/render";
import {decode as decodeHtmlEntities} from "html-entities";
import {ComponentProps} from "react";
import {NotificationDigestEmailTemplate} from "~/server/emails/internal/templates/notification_digest_email_template.js";
import {SignInEmailTemplate} from "~/server/emails/internal/templates/sign_in_email_template.js";
import {SpaceInviteEmailTemplate} from "~/server/emails/internal/templates/space_invite_email_template.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

// To preserve types, we must explicitly set keys and their respective templates / names.
// If we use maps or other iterables, we'll lose prop type validation.
export const emailTemplates = {
    SignIn: createEmailTemplate(SignInEmailTemplate, "SignIn"),
    SpaceInvite: createEmailTemplate(SpaceInviteEmailTemplate, "SpaceInvite"),
    NotificationDigest: createEmailTemplate(NotificationDigestEmailTemplate, "NotificationDigest"),
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
     * Get the title of the HTML email content. You should use the title as the
     * email subject.
     */
    readonly title: string;
};

export type EmailTemplates = typeof emailTemplates;

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
        const html = await render(<Component {...(props as any)} />);
        const title = getTitleFromHtml(html);
        return {
            templateName,
            html,
            title,
        };
    };
}

export function renderReactEmailTemplate<Template extends keyof EmailTemplates>(
    tracer: TracerContextModule,
    {
        templateName,
        templateProps,
    }: {templateName: Template; templateProps: Parameters<EmailTemplates[Template]>[0]},
): Promise<RenderedEmail> {
    return tracer.withSpan("React email render", async () => {
        // TS is already validating templateProps assumes the props from
        // templateName on emailTemplates. Given we don't know which templateName
        // is going to be passed in here, TS has a hard time finding which props
        // it expects here. The usage of this function should validate templateProps'
        // just fine.
        return emailTemplates[templateName](templateProps as any);
    });
}
