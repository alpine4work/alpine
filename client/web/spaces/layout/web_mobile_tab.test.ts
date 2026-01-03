import {Location} from "@remix-run/router";
import {getWebMobileTabFromLocation} from "~/client/web/spaces/layout/web_mobile_tab.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

function createLocation(pathname: string, search: string = ""): Location {
    return {
        pathname,
        search,
        hash: "",
        state: null,
        key: "default",
    };
}

describe("getWebMobileTabFromLocation", () => {
    const spaceId = generateId<SpaceId>();

    test("returns Home for space root path", () => {
        const location = createLocation(`/s/${spaceId}`);
        expect(getWebMobileTabFromLocation(location)).toEqual("Home");
    });

    test("returns Search for space search path", () => {
        const location = createLocation(`/s/${spaceId}/search`);
        expect(getWebMobileTabFromLocation(location)).toEqual("Search");
    });

    test("returns Create for space create path", () => {
        const location = createLocation(`/s/${spaceId}/create`);
        expect(getWebMobileTabFromLocation(location)).toEqual("Create");
    });

    test("returns Inbox for space inbox path", () => {
        const location = createLocation(`/s/${spaceId}/inbox`);
        expect(getWebMobileTabFromLocation(location)).toEqual("Inbox");
    });

    test("returns More for space more path", () => {
        const location = createLocation(`/s/${spaceId}/more`);
        expect(getWebMobileTabFromLocation(location)).toEqual("More");
    });

    test("returns Inbox when inbox=show query param is present on non-matching path", () => {
        const location = createLocation(`/s/${spaceId}/other`, "?inbox=show");
        expect(getWebMobileTabFromLocation(location)).toEqual("Inbox");
    });

    test("returns tab when matching root path and query params are present", () => {
        const location = createLocation(`/s/${spaceId}/search`, "?q=test");
        expect(getWebMobileTabFromLocation(location)).toEqual("Search");
    });

    test("returns matching tab with trailing slash", () => {
        const location = createLocation(`/s/${spaceId}/`);
        expect(getWebMobileTabFromLocation(location)).toEqual("Home");
    });

    test("returns null when location is null", () => {
        expect(getWebMobileTabFromLocation(null)).toEqual(null);
    });

    test("returns null for non-matching path without query params", () => {
        const location = createLocation(`/s/${spaceId}/other`);
        expect(getWebMobileTabFromLocation(location)).toEqual(null);
    });

    test("returns null for non-space path", () => {
        const location = createLocation(`/other/path`);
        expect(getWebMobileTabFromLocation(location)).toEqual(null);
    });

    test("returns null when inbox query param has value other than show", () => {
        const location = createLocation(`/s/${spaceId}/other`, "?inbox=hide");
        expect(getWebMobileTabFromLocation(location)).toEqual(null);
    });

    test("returns null when query params exist but no inbox param", () => {
        const location = createLocation(`/s/${spaceId}/other`, "?foo=bar");
        expect(getWebMobileTabFromLocation(location)).toEqual(null);
    });

    test("returns null for path with extra segments after tab", () => {
        const location = createLocation(`/s/${spaceId}/inbox/nested`);
        expect(getWebMobileTabFromLocation(location)).toEqual(null);
    });

    test("returns null for path with invalid characters in spaceId", () => {
        const invalidSpaceId = "abc-123_456";
        const location = createLocation(`/s/${invalidSpaceId}/inbox`);
        expect(getWebMobileTabFromLocation(location)).toEqual(null);
    });
});
