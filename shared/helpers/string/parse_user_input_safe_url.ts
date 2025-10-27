import {validate as validateEmail} from "email-validator";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {getUrlRegExp} from "~/shared/helpers/string/url_reg_exp.js";

const popularTLDs = new Set([
    "com",
    "net",
    "org",
    "jp",
    "de",
    "uk",
    "fr",
    "br",
    "it",
    "ru",
    "es",
    "me",
    "gov",
    "pl",
    "ca",
    "au",
    "cn",
    "co",
    "in",
    "nl",
    "edu",
    "info",
    "eu",
    "ch",
    "id",
    "at",
    "kr",
    "cz",
    "mx",
    "be",
    "tv",
    "se",
    "tr",
    "tw",
    "al",
    "ua",
    "ir",
    "vn",
    "cl",
    "sk",
    "ly",
    "cc",
    "to",
    "no",
    "fi",
    "us",
    "pt",
    "dk",
    "ar",
    "hu",
    "tk",
    "gr",
    "il",
    "news",
    "ro",
    "my",
    "biz",
    "ie",
    "za",
    "nz",
    "sg",
    "ee",
    "th",
    "io",
    "xyz",
]);

const startsWithProtocolRegexp = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const isIPAddressRegexp = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const blockedUrl = "about:blank#blocked";

function parseUserEmailInputSafeUrl(url: string) {
    const email = url.slice("mailto:".length);
    return validateEmail(email) ? url : blockedUrl;
}

function parseUserDomainInputSafeUrl(url: string) {
    let currentUrl = url;

    // If it doesn't have a protocol, assume https://
    const startsWithProtocol = startsWithProtocolRegexp.test(currentUrl);
    if (!startsWithProtocol) {
        currentUrl = "https://" + url;
    }

    if (!startsWithSafeUrlProtocol(currentUrl)) {
        return blockedUrl;
    }

    // If we can't parse it, don't trust it
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(currentUrl);
    } catch {
        return blockedUrl;
    }

    // Check for good domain format
    const domain = parsedUrl.hostname;
    const domainParts = domain.split(".");
    const urlRegExp = getUrlRegExp({global: false});

    if (domainParts.length < 2 || !urlRegExp.test(domain) || isIPAddressRegexp.test(domain)) {
        // If we are in an integration test or development environment, allow local links.
        // Do not allow local in unit tests so we can validate production blocks these properly.
        const allowLocal =
            (process.env.NODE_ENV === "test" && (globalThis as any).__isIntegrationTest) ||
            process.env.NODE_ENV === "development";

        if (allowLocal && (domain === "localhost" || domain === "127.0.0.1")) {
            return currentUrl;
        }
        return blockedUrl;
    }

    // Let's only inherently trust the most common TLDs.
    const tld = assertExists(domainParts[domainParts.length - 1]).toLowerCase();
    if (!startsWithProtocol && !popularTLDs.has(tld)) {
        return blockedUrl;
    }

    return currentUrl;
}

/**
 * We only allow linking to URLs with an email, HTTP, or HTTPS scheme.
 * That way we avoid XSS vulnerabilities with URLs that look like `javascript:alert('XSS')`.
 * If the URL doesn't start with a valid scheme we assume it's a web URL and
 * prepend `https://` to it.
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
