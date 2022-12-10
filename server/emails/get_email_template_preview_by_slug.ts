/**
 * Get all of our email template previews (at least one per template) in a map
 * keyed by slug.
 *
 * This is an async function because we lazy load our email code. Otherwise it
 * negatively impacts Cloudflare Worker startup times. We put all our email
 * code in an `internal` folder so you're forced to use the public API which
 * lazy loads the email code.
 */
export async function getEmailTemplatePreviewBySlug() {
    // TODO(calebmer): Consider putting the email stuff in a separate Cloudflare
    // worker or in a Node.js service so it doesn't eat into our app worker bundle
    // size limit.
    const {emailTemplatePreviewBySlug} = await import(
        "~/server/emails/internal/email_template_previews"
    );
    return emailTemplatePreviewBySlug;
}
