export async function getEmailPreviews() {
    // Lazy-load dependencies that need `mjml` since `mjml` affects worker script
    // startup time.
    //
    // We put email code in the `internal` folder to force use of lazy imports.
    const {emailPreviews} = await import("~/server/emails/internal/email_previews");
    return emailPreviews;
}
