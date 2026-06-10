import {genericEmailAddressDomains} from "~/shared/accounts/generic_email_address_domains.js";

export function validateEmailAddressForAuthentication(emailAddress: string) {
    const emailAddressDomain = emailAddress.split("@", 2)[1];
    const emailAddressDomainBeforeFirstDot = emailAddressDomain?.split(".", 2)[0];

    // True when `emailAddress` has an `@` followed by a `.`
    const isEmailAddressValid =
        emailAddressDomain !== undefined &&
        emailAddressDomainBeforeFirstDot !== undefined &&
        emailAddressDomain.length > emailAddressDomainBeforeFirstDot.length;

    // True if the email address domain before the first `.` we consider a generic
    // domain. We only check the domain up until the first dot so this turns true at
    // the same time we consider the email address valid. So the user definitely sees
    // our tip before pressing the "Sign up" button.
    const isEmailAddressPossiblyGeneric =
        isEmailAddressValid &&
        genericEmailAddressDomains
            .get()
            .beforeFirstDotSet.has(emailAddressDomainBeforeFirstDot.toLowerCase());

    return {isEmailAddressValid, isEmailAddressPossiblyGeneric};
}
