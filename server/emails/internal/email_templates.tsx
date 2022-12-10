import {decode as decodeHtmlEntities} from "html-entities";
import {render} from "mjml-react";
import {ComponentProps} from "react";
import {SignInEmailTemplate} from "~/server/emails/internal/sign_in_email_template";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";

const emailTemplateComponents = {
    SignIn: SignInEmailTemplate,
};

/**
 * The result of rendering an email template.
 */
export type RenderedEmail = {
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

/**
 * A map of template names to functions which will generate HTML for the
 * template. Uses `mjml-react` under the hood.
 *
 * We have this level of indirection because we need to take care to not put
 * `mjml-react` in our main bundle or it will cause the Cloudflare Worker
 * startup time to be too slow. This way callers can reference a string key
 * instead of importing a component that pulls in `mjml-react`.
 */
export const emailTemplates = mapObjectValues(emailTemplateComponents, Component => {
    return (props: ComponentProps<typeof Component>): RenderedEmail => {
        const {html} = render(<Component {...props} />, {
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
            html,
            getHtmlTitle,
        };
    };
});
