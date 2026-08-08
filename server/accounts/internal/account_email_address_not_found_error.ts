import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {UrlPath} from "~/shared/helpers/http/url_path.open_source.js";

export function accountEmailAddressNotFoundError(
    emailAddress: string,
    options: {toSearchParam: string | null},
) {
    return new NotFoundError("Account email address not found", {
        displayMessage: accountEmailAddressNotFoundErrorDisplayMessage(emailAddress, options),
    });
}

function accountEmailAddressNotFoundErrorDisplayMessage(
    emailAddress: string,
    {toSearchParam}: {toSearchParam: string | null},
) {
    const urlPath = new UrlPath("/auth/sign-up");

    urlPath.searchParams.set("email", emailAddress);
    if (toSearchParam) urlPath.searchParams.set("to", toSearchParam);

    return errorDisplayMessage`Can\u2019t find an account for \u201C${emailAddress}\u201D. Try again with a different email or ${errorDisplayMessage.link(
        "sign up",
        urlPath.toString(),
    )}.`;
}
