import {genericEmailAddressDomains} from "~/shared/accounts/generic_email_address_domains.js";

const testCases: Array<[string, boolean]> = [
    ["gmail.com", true],
    ["yahoo.com", true],
    ["hey.com", true],
    ["me.com", true],
    ["icloud.com", true],
    ["netflix.com", false],
    ["berkeley.edu", false],
    ["makenotion.com", false],
];

for (const [emailDomain, isGeneric] of testCases) {
    test(`${emailDomain} is ${isGeneric ? "generic" : "not generic"}`, () => {
        expect(genericEmailAddressDomains.get().set.has(emailDomain)).toBe(isGeneric);
    });
}
