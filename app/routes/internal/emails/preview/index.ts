import {redirect} from "@remix-run/server-runtime";
import {getEmailPreviews} from "~/server/emails/get_email_previews";

export async function loader() {
    const emailPreviews = await getEmailPreviews();
    return redirect(`/internal/emails/preview/${Array.from(emailPreviews.keys())[0]!}`);
}
