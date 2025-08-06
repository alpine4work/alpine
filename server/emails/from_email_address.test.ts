import {
    FromEmailAddress,
    getFormattedFromEmailAddress,
} from "~/server/emails/from_email_address.js";
import {InternalError} from "~/shared/error/error.js";

describe("getFormattedEmailAddress", () => {
    const rawFromAddress: FromEmailAddress = {
        displayName: "Alpine",
        address: "test@alpine.inc",
    };
    test("correctly formats in name-addr format", () => {
        const actual = getFormattedFromEmailAddress(rawFromAddress, "name-addr");
        // eslint-disable-next-line string-quotes
        expect(actual).toBe('"Alpine" <test@alpine.inc>');
    });
    test("correctly formats in addr-spec format", () => {
        const actual = getFormattedFromEmailAddress(rawFromAddress, "addr-spec");
        expect(actual).toBe("test@alpine.inc");
    });
    test("correctly formats in unspecified format", () => {
        const actual = getFormattedFromEmailAddress(rawFromAddress);
        expect(actual).toBe("test@alpine.inc");
    });
    test("throws with missing displayName for name-addr format", () => {
        expect(() => {
            getFormattedFromEmailAddress({address: "test@alpine.inc"}, "name-addr");
        }).toThrow(InternalError);
    });
});
