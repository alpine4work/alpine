import {
    FromEmailAddress,
    getFromEmailAddressAddrSpec,
    getFromEmailAddressNameAddr,
} from "~/server/emails/from_email_address.js";
import {InternalError} from "~/shared/error/error.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";

const rawFromAddress: FromEmailAddress = {
    displayName: "Alpine",
    address: validateEmailAddress("test@alpine.inc"),
};

test("correctly formats in name-addr format", () => {
    const actual = getFromEmailAddressNameAddr(rawFromAddress);
    // eslint-disable-next-line cyberworlds/string-quotes
    expect(actual).toBe('"Alpine" <test@alpine.inc>');
});

test("correctly formats in addr-spec format", () => {
    const actual = getFromEmailAddressAddrSpec(rawFromAddress);
    expect(actual).toBe("test@alpine.inc");
});

test("throws with missing displayName for name-addr format", () => {
    expect(() => {
        getFromEmailAddressNameAddr({address: validateEmailAddress("test@alpine.inc")});
    }).toThrow(InternalError);
});
