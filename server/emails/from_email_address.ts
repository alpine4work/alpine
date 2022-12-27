import {exhaustive} from "~/shared/helpers/control/exhaustive";

/**
 * Email addresses we are allowed to send email from. We have a handful of
 * email addresses we allow sending email from. They are curated and documented
 * here. All email addresses must follow the best practices from [here][1].
 * Notably:
 *
 * - Avoid no-reply addresses which makes it look like we don't want feedback
 *   from our users.
 * - Use subdomains for different classes of communication. Subdomains develop
 *   their own reputation. We want authentication emails to have very high
 *   reputation. Notification and marketing emails may not have the same high
 *   reputation. For instance we may have `auth.cyberworlds.dev`,
 *   `notification.cyberworlds.dev`, and `news.cyberworlds.dev`
 *   (for marketing) which develop different reputations.
 *
 * Remember that from addresses are UI! A user will see them prominently in
 * their email client. So pick an email address that's human and user friendly.
 *
 * [1]: https://docs.aws.amazon.com/ses/latest/dg/tips-and-best-practices.html
 */
export enum FromEmailAddress {
    /**
     * We send sign in codes and other emails related to authenticating with our
     * service through this email address. We should try to maintain high
     * reputation for this email address.
     */
    SignIn = "SignIn",

    /**
     * We use this address to send alpha management emails to internal users.
     */
    Alpha = "Alpha",

    /**
     * Send an email as Caleb Meredith.
     */
    Caleb = "Caleb",
}

/**
 * Get the actual email address of a `FromEmailAddress`.
 */
export function getFromEmailAddress(fromEmailAddress: FromEmailAddress): string {
    switch (fromEmailAddress) {
        case FromEmailAddress.SignIn:
            return "sign-in@cyberworlds.dev";
        case FromEmailAddress.Alpha:
            return "alpha@cyberworlds.dev";
        case FromEmailAddress.Caleb:
            return "caleb@cyberworlds.dev";
        default:
            throw exhaustive(fromEmailAddress);
    }
}

/**
 * Get the name associated with a `FromEmailAddress`.
 */
export function getFromEmailAddressName(fromEmailAddress: FromEmailAddress): string {
    switch (fromEmailAddress) {
        case FromEmailAddress.SignIn:
        case FromEmailAddress.Alpha:
            return "Cyberworlds";
        case FromEmailAddress.Caleb:
            return "Caleb Meredith";
        default:
            throw exhaustive(fromEmailAddress);
    }
}
