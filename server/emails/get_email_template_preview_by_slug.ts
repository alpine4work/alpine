/**
 * Get all of our email template previews (at least one per template) in a map
 * keyed by slug.
 *
 * This is an async function because we lazy load our email code. Otherwise it
 * negatively impacts startup times. Importing `mjml-react` alone takes ~300ms!
 * We put all our email code in an `internal` folder so you're forced to use
 * the public API which lazy loads the email code.
 */
export async function getEmailTemplatePreviewBySlug() {
    const {emailTemplatePreviewBySlug} = await import(
        "~/server/emails/internal/email_template_previews.js"
    );
    return emailTemplatePreviewBySlug;
}
