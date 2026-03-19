import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Locale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";

export function getErrorDisplayMessageForPartialInviteAccountsFailure(
    locale: Locale,
    successfulInviteCount: number,
    errors: {
        readonly unexpectedFailureEmailAddresses: ReadonlyMap<string, unknown>;
        readonly invalidEmailAddresses: ReadonlyArray<string>;
        readonly rejectedAsSpamEmailAddresses: ReadonlyArray<string>;
        readonly alreadyMemberEmailAddresses: ReadonlyArray<string>;
        readonly requiresAdminAccessEmailAddresses: ReadonlyArray<string>;
    },
) {
    const unexpectedFailureEmailAddressArray = Array.from(
        errors.unexpectedFailureEmailAddresses.keys(),
    );

    assert(
        unexpectedFailureEmailAddressArray.length > 0 ||
            errors.invalidEmailAddresses.length > 0 ||
            errors.rejectedAsSpamEmailAddresses.length > 0 ||
            errors.alreadyMemberEmailAddresses.length > 0 ||
            errors.requiresAdminAccessEmailAddresses.length > 0,
        "Tried rendering an error message for people invite with no errors",
    );

    const errorMessages = [];

    if (successfulInviteCount > 0) {
        errorMessages.push(
            `Successfully invited ${printPrettyNumber(locale, successfulInviteCount, "person", {
                pluralLabel: "people",
            })}`,
        );
    }

    if (unexpectedFailureEmailAddressArray.length > 0) {
        errorMessages.push(
            `${intoErrorDisplayMessage(
                locale,
                unexpectedFailureEmailAddressArray,
            )} couldn\u2019t be invited due to an unexpected error`,
        );
    }

    if (errors.requiresAdminAccessEmailAddresses.length > 0) {
        errorMessages.push(
            `${intoErrorDisplayMessage(locale, errors.requiresAdminAccessEmailAddresses)} can only be invited by an admin`,
        );
    }

    if (errors.invalidEmailAddresses.length > 0) {
        const description =
            errors.invalidEmailAddresses.length === 1
                ? "isn\u2019t a valid email address"
                : "aren\u2019t valid email addresses";

        errorMessages.push(
            `${intoErrorDisplayMessage(locale, errors.invalidEmailAddresses)} ${description}`,
        );
    }

    if (errors.rejectedAsSpamEmailAddresses.length > 0) {
        errorMessages.push(
            `${intoErrorDisplayMessage(
                locale,
                errors.rejectedAsSpamEmailAddresses,
            )} rejected a previous invite`,
        );
    }

    if (errors.alreadyMemberEmailAddresses.length > 0) {
        const description =
            errors.alreadyMemberEmailAddresses.length === 1
                ? "is already a member of the space"
                : "are already members of the space";

        errorMessages.push(
            `${intoErrorDisplayMessage(locale, errors.alreadyMemberEmailAddresses)} ${description}`,
        );
    }

    return errorMessages.join(". ").trim() + ".";
}

function intoErrorDisplayMessage(locale: Locale, failedEmailAddresses: ReadonlyArray<string>) {
    const firstThreeEmailAddresses = failedEmailAddresses.slice(0, 3);
    const remainingEmailAddressesCount =
        failedEmailAddresses.length - firstThreeEmailAddresses.length;

    if (remainingEmailAddressesCount > 0) {
        firstThreeEmailAddresses.push(
            printPrettyNumber(locale, remainingEmailAddressesCount, "other", {
                pluralLabel: "others",
            }),
        );
    }

    return joinPrettyConjunctionList(firstThreeEmailAddresses, "and");
}
