import {
    extractAddrSpecFromAddressListItem,
    parseEmailAddressListHeader,
    splitEmailAddressListHeader,
} from "~/server/emails/mime/parse_email_address_list_header.js";

/* eslint-disable cyberworlds/string-quotes -- RFC 5322 fixtures use ASCII double quotes */

describe("splitEmailAddressListHeader", () => {
    test("splits bare addresses on comma", () => {
        expect(splitEmailAddressListHeader("a@b.com, c@d.com")).toEqual(["a@b.com", "c@d.com"]);
    });

    test("does not split comma inside quoted display name", () => {
        expect(
            splitEmailAddressListHeader(`"Doe, Jane" <jane@example.com>, bob@example.com`),
        ).toEqual([`"Doe, Jane" <jane@example.com>`, "bob@example.com"]);
    });

    test("does not split comma inside angle-addr", () => {
        expect(splitEmailAddressListHeader(`"x" <a@b.com>, c@d.com`)).toEqual([
            `"x" <a@b.com>`,
            "c@d.com",
        ]);
    });
});

describe("extractAddrSpecFromAddressListItem", () => {
    test("returns addr inside angle brackets", () => {
        expect(extractAddrSpecFromAddressListItem("Alice <alice@example.com>")).toBe(
            "alice@example.com",
        );
    });

    test("returns bare address when no angle brackets", () => {
        expect(extractAddrSpecFromAddressListItem("bob@example.com")).toBe("bob@example.com");
    });

    test("strips surrounding quotes around bare addr-spec", () => {
        expect(extractAddrSpecFromAddressListItem(`"user@example.com"`)).toBe("user@example.com");
    });
});

describe("parseEmailAddressListHeader", () => {
    test("parses multiple bare addresses", () => {
        expect(parseEmailAddressListHeader("a@b.com, c@d.com")).toEqual(["a@b.com", "c@d.com"]);
    });

    test("parses quoted name with comma and second address", () => {
        expect(
            parseEmailAddressListHeader(`"Doe, Jane" <jane@example.com>, bob@example.com`),
        ).toEqual(["jane@example.com", "bob@example.com"]);
    });

    test("returns empty list for empty header", () => {
        expect(parseEmailAddressListHeader("")).toEqual([]);
    });

    test("skips empty group segment", () => {
        expect(parseEmailAddressListHeader("undisclosed-recipients:;, alice@example.com")).toEqual([
            "alice@example.com",
        ]);
    });
});
