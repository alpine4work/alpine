import {redirect} from "@remix-run/server-runtime";
import {getEmailTemplatePreviewBySlug} from "~/server/emails/get_email_template_preview_by_slug";

export async function loader() {
    const emailPreviews = await getEmailTemplatePreviewBySlug();
    return redirect(`/internal/emails/preview/${Array.from(emailPreviews.keys())[0]!}`);
}
