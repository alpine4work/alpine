import {redirect} from "@remix-run/server-runtime";
import {emailTemplatePreviewBySlug} from "~/server/emails/email_template_previews.js";

export async function loader() {
    const emailPreviews = emailTemplatePreviewBySlug;
    return redirect(`/internal/emails/preview/${Array.from(emailPreviews.keys())[0]!}`);
}
