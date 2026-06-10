import {getEmailDomainForAutoAddSpaceAccounts} from "~/shared/accounts/get_email_domain_for_auto_add_space_accounts.js";

const testCases: Array<{emailAddress: string; expectedEmailDomain: string | null}> = [
    {emailAddress: "person@netflix.com", expectedEmailDomain: "netflix.com"},
    {emailAddress: "person@Berkeley.EDU", expectedEmailDomain: "berkeley.edu"},
    {emailAddress: "person@gmail.com", expectedEmailDomain: null},
    {emailAddress: "person", expectedEmailDomain: null},
    {emailAddress: "person@", expectedEmailDomain: null},
    {emailAddress: "person@netflix.com/path", expectedEmailDomain: null},
    {emailAddress: "person@netflix.com:443", expectedEmailDomain: null},
];

for (const {emailAddress, expectedEmailDomain} of testCases) {
    test(`${emailAddress} resolves to ${expectedEmailDomain ?? "null"}`, () => {
        expect(getEmailDomainForAutoAddSpaceAccounts(emailAddress)).toBe(expectedEmailDomain);
    });
}
