import {decode as decodeHtmlEntities} from "html-entities";
import {render} from "mjml-react";
import {ComponentProps} from "react";
import {AlphaAccessRequestApprovedEmailTemplate} from "~/server/emails/internal/alpha_access_request_approved_email_template.js";
import {RequestedAlphaAccessEmailTemplate} from "~/server/emails/internal/requested_alpha_access_email_template.js";
import {SignInEmailTemplate} from "~/server/emails/internal/sign_in_email_template.js";
import {SpaceInviteEmailTemplate} from "~/server/emails/internal/space_invite_email_template.js";

// To preserve types, we must explicitly set keys and their respective templates / names.
// If we use maps or other iterables, we'll lose prop type validation.
export const emailTemplates = {
    SignIn: createEmailTemplate(SignInEmailTemplate, "SignIn"),
    RequestedAlphaAccess: createEmailTemplate(
        RequestedAlphaAccessEmailTemplate,
        "RequestedAlphaAccess",
    ),
    AlphaAccessRequestApproved: createEmailTemplate(
        AlphaAccessRequestApprovedEmailTemplate,
        "AlphaAccessRequestApproved",
    ),
    SpaceInvite: createEmailTemplate(SpaceInviteEmailTemplate, "SpaceInvite"),
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
    getHtmlTitle(): string;
};

function createEmailTemplate<T>(Component: React.ComponentType<T>, templateName: string) {
    return (props: ComponentProps<typeof Component>): RenderedEmail => {
        const {html} = render(<Component {...(props as any)} />, {
            // We can ignore `errors` since with a strict validation level we will throw if
            // there is a validation error.
            validationLevel: "strict",
        });

        const getHtmlTitle = (): string => {
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
        };

        return {
            templateName,
            html,
            getHtmlTitle,
        };
    };
}

export type EmailTemplates = typeof emailTemplates;
