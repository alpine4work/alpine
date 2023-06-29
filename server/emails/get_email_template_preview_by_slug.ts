/**
 * Get all of our email template previews (at least one per template) in a map
 * keyed by slug.
 *
 * This is an async function because we lazy load our email code. Otherwise it
 * negatively impacts startup times. We put all our email code in an `internal`
 * folder so you're forced to use the public API which lazy loads the email code.
 */
// NOTE(calebmer): Originally we lazy loaded email code because we ran this
// code in Cloudflare Workers and the startup time exceeded the limit. We're
// keeping that code style for now since it's easy but we should consider directly
// importing email components.
export async function getEmailTemplatePreviewBySlug() {
    const {emailTemplatePreviewBySlug} = await import(
        "~/server/emails/internal/email_template_previews.js"
    );
    return emailTemplatePreviewBySlug;
}
