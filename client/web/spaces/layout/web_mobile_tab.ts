import {Location} from "@remix-run/router";
import {spaceLayoutStyles} from "~/client/web/styles/styles.js";
import {isId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type WebMobileTab = SchemaType<typeof WebMobileTabSchema>;
export const WebMobileTabSchema = Schema.enum(spaceLayoutStyles.webMobileTabs);

export function getWebMobileTabFromLocation(location: Location | null): WebMobileTab | null {
    if (!location) {
        return null;
    }

    const match = location.pathname.match(/^\/(home|search|create|inbox|more)\/([^/]+)\/?$/);

    if (!match && !location.search) {
        return null;
    } else if (match) {
        if (!isId<SpaceId>(match[2]!)) return null;

        switch (match[1]) {
            case "home":
                return "Home";
            case "search":
                return "Search";
            case "create":
                return "Create";
            case "inbox":
                return "Inbox";
            case "more":
                return "More";
            default:
                return null;
        }
    } else if (location.search) {
        const queryParams = new URLSearchParams(location.search);
        const inboxQueryParam = queryParams.get("inbox");
        if (inboxQueryParam === "show") {
            return "Inbox";
        }
    }

    return null;
}
