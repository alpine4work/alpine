import {validate as validateEmail} from "email-validator";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {getUrlRegExp} from "~/shared/helpers/string/url_reg_exp.js";

const startsWithProtocolRegexp = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

const blockedUrl = "about:blank#blocked";

function parseUserEmailInputSafeUrl(url: string) {
    const email = url.slice("mailto:".length);
    return validateEmail(email) ? url : blockedUrl;
}

function parseUserDomainInputSafeUrl(url: string) {
    let currentUrl = url;

    // Make sure the URL matches our URL regex before we add a protocol.
    const urlRegExp = getUrlRegExp({global: false});
    if (!urlRegExp.test(currentUrl)) {
        return blockedUrl;
    }

    // If it doesn't have a protocol, assume https://
    const startsWithProtocol = startsWithProtocolRegexp.test(currentUrl);
    if (!startsWithProtocol) {
        if (url.startsWith("localhost:")) {
            currentUrl = "http://" + url;
        } else {
            currentUrl = "https://" + url;
        }
    }

    if (!startsWithSafeUrlProtocol(currentUrl)) {
        return blockedUrl;
    }

    // If we can't parse it, don't trust it
    try {
        new URL(currentUrl);
    } catch {
        return blockedUrl;
    }

    return currentUrl;
}

/**
 * We only allow linking to URLs with an email, HTTP, or HTTPS scheme. That way we
 * avoid XSS vulnerabilities with URLs that look like `javascript:alert('XSS')`. If
 * the URL doesn't start with a valid scheme we assume it's a web URL and prepend
 * `https://` to it.
 */
export function parseUserInputSafeUrl(url: unknown) {
    if (typeof url !== "string") {
        return blockedUrl;
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl.startsWith("mailto:")) {
        return parseUserEmailInputSafeUrl(trimmedUrl);
    } else {
        return parseUserDomainInputSafeUrl(trimmedUrl);
    }
}
