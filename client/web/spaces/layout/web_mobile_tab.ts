import {spaceLayoutStyles} from "~/client/web/styles/styles.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type WebMobileTab = SchemaType<typeof WebMobileTabSchema>;
export const WebMobileTabSchema = Schema.enum(spaceLayoutStyles.webMobileTabs);

export function getWebMobileTabFromPathname(pathname: string): WebMobileTab | null {
    const match = pathname.match(/^\/s\/(?:[a-zA-Z0-9]+)(\/search|\/create|\/inbox|\/more)?$/);
    if (!match) return null;

    switch (match[1]) {
        case undefined:
            return "Home";
        case "/search":
            return "Search";
        case "/create":
            return "Create";
        case "/inbox":
            return "Inbox";
        case "/more":
            return "More";
        default:
            return null;
    }
}
