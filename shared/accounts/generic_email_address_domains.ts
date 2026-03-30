import freeEmailDomains from "free-email-domains/domains.json" with {type: "json"};
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

/**
 * Email domains we don't consider work email domains. For work domains, we create
 * a space for all email address with that domain.
 */
export const genericEmailAddressDomains = new Lazy(() => {
    const set = new Set<string>();
    const beforeFirstDotSet = new Set<string>();

    const addDomain = (domain: string) => {
        set.add(domain);

        const firstDotIndex = domain.indexOf(".");
        assert(firstDotIndex !== -1);
        beforeFirstDotSet.add(domain.slice(0, firstDotIndex));
    };

    // `@hey.com` doesn't appear in the npm package we use, but we consider it a
    // generic domain. Don't want everyone using `@hey.com` to be added to the same
    // workspace!
    addDomain("hey.com");

    // `@test.cyberworlds.dev` is a generic domain used for testing. For test company
    // email address domains we use something like
    // `@${generateId}.test.cyberworlds.dev` or `@test1.cyberworlds.dev`.
    //
    // Also nice since helpers like `generateEmailAddressForTest()` and
    // `generateEmailAddressForDevConsole()` won't automatically generate emails that
    // are added to the same space.
    addDomain("test.cyberworlds.dev");

    freeEmailDomains.forEach(addDomain);

    return {set, beforeFirstDotSet};
});
