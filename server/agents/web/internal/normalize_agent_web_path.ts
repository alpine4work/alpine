import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

export function normalizeAgentWebPath(pathString: string): {
    path: string;
    pathname: string;
    searchParams: URLSearchParams;
} {
    // Add a leading slash in case the LLM forgot to add one.
    if (!pathString.startsWith("/")) pathString = `/${pathString}`;

    // Remove the hash part of the URL before resolving. Just like in an actual web
    // server! The hash part is only visible to the client, it's not visible to the
    // `[ChatGPT](/bot/chatgpt#short)`. Since the short name for "ChatGPT" is
    // "ChatGPT".
    pathString = pathString.replace(/#.*$/, "");

    const path = new UrlPath(pathString);

    const normalizedSearchParams = new URLSearchParams(
        Array.from(path.searchParams.entries()).sort(([key1], [key2]) =>
            defaultCompareStrings(key1, key2),
        ),
    );

    let normalizedPath = path.pathname;

    if (normalizedSearchParams.size > 0) {
        normalizedPath += "?" + normalizedSearchParams.toString();
    }

    return {
        path: normalizedPath,
        pathname: path.pathname,
        searchParams: normalizedSearchParams,
    };
}
