import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";

const emailAddressCount = new Map<string, number>();

export function generateEmailAddressForTest(account?: TestAccount) {
    const id = account?.id || "anonymous";

    const emailAddressNumber = emailAddressCount.get(id) || 0;
    emailAddressCount.set(id, emailAddressNumber + 1);

    return `account.${id}${
        emailAddressNumber > 0 ? `.${emailAddressNumber + 1}` : ""
    }@test.cyberworlds.dev`;
}
