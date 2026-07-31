import {documentationApiHomeUrl} from "~/shared/docs/documentation_api_home_url.js";

/**
 * The URL for an API "Get started" page other than the home page, e.g.
 * `authentication` -> `/docs/api/authentication`. The home page (Introduction)
 * lives at {@link documentationApiHomeUrl}.
 */
export function createDocumentationApiPageUrl(page: string): string {
    return `${documentationApiHomeUrl}/${page}`;
}
