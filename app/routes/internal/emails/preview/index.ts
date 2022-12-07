import {redirect} from "@remix-run/server-runtime";
import {emailPreviews} from "~/server/emails/email_previews";

export function loader() {
    return redirect(`/internal/emails/preview/${Array.from(emailPreviews.keys())[0]!}`);
}
