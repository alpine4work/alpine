import {genericEmailAddressDomains} from "~/shared/accounts/generic_email_address_domains.js";

export function getEmailDomainForAutoAddSpaceAccounts(emailAddress: string): string | null {
    const emailAddressParts = emailAddress.split("@", 2);
    if (emailAddressParts.length !== 2) return null;

    const emailDomain = emailAddressParts[1]!.toLowerCase();

    let url: URL;
    try {
        url = new URL(`https://${emailDomain}`);
    } catch {
        // Not a valid URL. Can't use `emailDomain`.
        return null;
    }

    // `emailDomain` is more than just the `hostname` part of a URL. Can't use
    // `emailDomain`.
    if (url.hostname !== emailDomain) return null;

    // `emailDomain` is a generic domain like `gmail.com` or `me.com` (iCloud). We
    // won't add accounts with a generic domain to the same space.
    //
    // The intent is to add all people from the same company into the same space
    // automatically. For example, if multiple people with `@netflix.com` email
    // addresses sign up, then we want them all to be placed in the same "Netflix"
    // space automatically. We don't want strangers (e.g. everyone with `@gmail.com`
    // emails) to be added to the same space.
    //
    // This check probably isn't perfect and we may need to moderate certain spaces
    // that get automatically created.
    //
    // One side effect I (@calebmer) expect is people with school email domains (e.g.
    // `@berkeley.edu`; could be students, faculty, or alumni) to be added to the same
    // space. The trust characteristics of a school email domain is different from a
    // company email domain, so we'll see how our auto-add policy needs to evolve. But
    // for now, we think adding everyone with a school email to the same space is a
    // good thing.
    if (genericEmailAddressDomains.get().set.has(emailDomain)) return null;

    return emailDomain;
}
