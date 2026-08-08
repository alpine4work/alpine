import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {EmailAddress, validateEmailAddress} from "~/shared/helpers/string/email_address.js";

export type FromEmailAddress = {
    displayName?: string;
    address: EmailAddress;
};

/**
 * Email addresses we are allowed to send email from. We have a handful of email
 * addresses we allow sending email from. They are curated and documented here. All
 * email addresses must follow the best practices from [here][1]. Notably:
 *
 * - Avoid no-reply addresses which makes it look like we don't want feedback from
 *   our users.
 * - Use subdomains for different classes of communication. Subdomains develop
 *   their own reputation. We want authentication emails to have very high
 *   reputation. Notification and marketing emails may not have the same high
 *   reputation. For instance we may have `auth.cyberworlds.dev`,
 *   `notification.cyberworlds.dev`, and `news.cyberworlds.dev` (for marketing)
 *   which develop different reputations.
 * - By default, email sent via SES from @alpine.inc addresses are sent from
 *   'mail.alpine.inc' as a custom MAIL FROM address.
 *
 * Remember that from addresses are UI! A user will see them prominently in their
 * email client. So pick an email address that's human and user friendly.
 *
 * [1]: https://docs.aws.amazon.com/ses/latest/dg/tips-and-best-practices.html
 */

export const FromEmailAddressAlias = {
    SignIn: {
        displayName: "Alpine",
        address: validateEmailAddress("sign-in@alpine.inc"),
    },
    SignUp: {
        displayName: "Alpine",
        address: validateEmailAddress("sign-up@alpine.inc"),
    },
    Invites: {
        displayName: "Alpine",
        address: validateEmailAddress("invites@alpine.inc"),
    },
    Inbox: {
        displayName: "Alpine",
        address: validateEmailAddress("inbox@alpine.inc"),
    },
} as const satisfies Record<string, FromEmailAddress>;

export type FromEmailAddressAlias = keyof typeof FromEmailAddressAlias;

/**
 * Get the RFC5322 formatted email address associated with a `FromEmailAddress`.
 */
export function getFromEmailAddressAddrSpec(emailAddress: FromEmailAddress): EmailAddress {
    return emailAddress.address;
}

/**
 * Get the RFC5322 formatted email address associated with a `FromEmailAddress`.
 */
export function getFromEmailAddressNameAddr(emailAddress: FromEmailAddress): string {
    assert(
        emailAddress.displayName,
        "Must include `displayName` for name-attr formatted from email",
    );
    // eslint-disable-next-line cyberworlds/string-quotes
    return `"${emailAddress.displayName}" <${emailAddress.address}>`;
}
