export async function getEmailPreviews() {
    // Lazy-load dependencies that need `mjml`. `mjml` imports many dependencies
    // which take a while to load. Get it off the initial startup path.
    //
    // We put email code in the `internal` folder to force use of lazy imports.
    //
    // TODO(calebmer): Consider putting the email stuff in a separate Cloudflare
    // worker or in a Node.js service so it doesn't eat into our app worker bundle
    // size limit.
    const {emailPreviews} = await import("~/server/emails/internal/email_previews");
    return emailPreviews;
}
