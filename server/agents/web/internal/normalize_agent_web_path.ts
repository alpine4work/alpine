import {UrlPath} from "~/shared/helpers/http/url_path.js";

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

    // We intentionally preserve the order of search params instead of sorting them.
    // Order is meaningful: task filter search params are position aware (adjacent
    // params with the same key merge into one filter and `break` params separate them,
    // see `parseAgentWebTaskQueryFilters()`).
    const searchParams = path.searchParams;

    let normalizedPath = path.pathname;

    if (searchParams.size > 0) {
        normalizedPath += "?" + searchParams.toString();
    }

    return {
        path: normalizedPath,
        pathname: path.pathname,
        searchParams,
    };
}
