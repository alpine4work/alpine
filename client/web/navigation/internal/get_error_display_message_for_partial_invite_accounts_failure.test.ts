import {getErrorDisplayMessageForPartialInviteAccountsFailure} from "~/client/web/navigation/internal/get_error_display_message_for_partial_invite_accounts_failure.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";

function createEmptyErrors() {
    return {
        unexpectedFailureEmailAddresses: new Map<string, unknown>(),
        invalidEmailAddresses: [] as ReadonlyArray<string>,
        rejectedAsSpamEmailAddresses: [] as ReadonlyArray<string>,
        alreadyMemberEmailAddresses: [] as ReadonlyArray<string>,
        requiresAdminAccessEmailAddresses: [] as ReadonlyArray<string>,
    };
}

describe("getErrorDisplayMessageForPartialInvitePeopleFailure", () => {
    test("throws error when no errors are provided", () => {
        expect(() => {
            getErrorDisplayMessageForPartialInviteAccountsFailure(
                defaultLocale,
                3,
                createEmptyErrors(),
            );
        }).toThrow(
            new InternalError(
                "Assertion failure: Tried rendering an error message for people invite with no errors",
            ),
        );
    });

    test("uses singular form for 1 person", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["notanemail"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            1,
            errors,
        );

        expect(result).toBe(
            "Successfully invited 1 person. notanemail isn\u2019t a valid email address.",
        );
    });

    test("omits success message when no invites succeeded", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["invalid@"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("invalid@ isn\u2019t a valid email address.");
    });

    test("shows message for single unexpected failure", () => {
        const errors = createEmptyErrors();
        errors.unexpectedFailureEmailAddresses.set("fail@example.com", {});

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe(
            "fail@example.com couldn\u2019t be invited due to an unexpected error.",
        );
    });

    test("shows message for multiple unexpected failures", () => {
        const errors = createEmptyErrors();
        errors.unexpectedFailureEmailAddresses.set("a@example.com", {});
        errors.unexpectedFailureEmailAddresses.set("b@example.com", {});

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe(
            "a@example.com and b@example.com couldn\u2019t be invited due to an unexpected error.",
        );
    });

    test("uses singular grammar for one invalid email", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["notanemail"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("notanemail isn\u2019t a valid email address.");
    });

    test("uses plural grammar for multiple invalid emails", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["bad1", "bad2"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("bad1 and bad2 aren\u2019t valid email addresses.");
    });

    test("shows message for emails that rejected previous invite", () => {
        const errors = createEmptyErrors();
        errors.rejectedAsSpamEmailAddresses = ["spam@example.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("spam@example.com rejected a previous invite.");
    });

    test("uses singular grammar for one already member", () => {
        const errors = createEmptyErrors();
        errors.alreadyMemberEmailAddresses = ["member@example.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("member@example.com is already a member of the space.");
    });

    test("uses plural grammar for multiple already members", () => {
        const errors = createEmptyErrors();
        errors.alreadyMemberEmailAddresses = ["a@example.com", "b@example.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("a@example.com and b@example.com are already members of the space.");
    });

    test("shows all emails when 3 or fewer", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["a@x.com", "b@x.com", "c@x.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe("a@x.com, b@x.com, and c@x.com aren\u2019t valid email addresses.");
    });

    test("truncates to 3 emails with singular other count", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["a@x.com", "b@x.com", "c@x.com", "d@x.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe(
            "a@x.com, b@x.com, c@x.com, and 1 other aren\u2019t valid email addresses.",
        );
    });

    test("truncates to 3 emails with plural others count", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            0,
            errors,
        );

        expect(result).toBe(
            "a@x.com, b@x.com, c@x.com, and 2 others aren\u2019t valid email addresses.",
        );
    });

    test("combines success with multiple error types", () => {
        const errors = createEmptyErrors();
        errors.invalidEmailAddresses = ["invalid@"];
        errors.alreadyMemberEmailAddresses = ["member@example.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            2,
            errors,
        );

        expect(result).toBe(
            "Successfully invited 2 people. invalid@ isn\u2019t a valid email address. member@example.com is already a member of the space.",
        );
    });

    test("combines all error types", () => {
        const errors = createEmptyErrors();
        errors.unexpectedFailureEmailAddresses.set("fail@example.com", {});
        errors.invalidEmailAddresses = ["invalid@"];
        errors.rejectedAsSpamEmailAddresses = ["spam@example.com"];
        errors.alreadyMemberEmailAddresses = ["member@example.com"];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            1,
            errors,
        );

        expect(result).toBe(
            "Successfully invited 1 person. fail@example.com couldn\u2019t be invited due to an unexpected error. " +
                "invalid@ isn\u2019t a valid email address. spam@example.com rejected a previous invite. " +
                "member@example.com is already a member of the space.",
        );
    });

    test("combines all error types with truncation for each", () => {
        const errors = createEmptyErrors();
        errors.unexpectedFailureEmailAddresses.set("fail1@example.com", {});
        errors.unexpectedFailureEmailAddresses.set("fail2@example.com", {});
        errors.unexpectedFailureEmailAddresses.set("fail3@example.com", {});
        errors.unexpectedFailureEmailAddresses.set("fail4@example.com", {});
        errors.unexpectedFailureEmailAddresses.set("fail5@example.com", {});
        errors.invalidEmailAddresses = ["inv1@", "inv2@", "inv3@", "inv4@"];
        errors.rejectedAsSpamEmailAddresses = [
            "spam1@example.com",
            "spam2@example.com",
            "spam3@example.com",
            "spam4@example.com",
            "spam5@example.com",
            "spam6@example.com",
        ];
        errors.alreadyMemberEmailAddresses = [
            "member1@example.com",
            "member2@example.com",
            "member3@example.com",
            "member4@example.com",
            "member5@example.com",
        ];

        const result = getErrorDisplayMessageForPartialInviteAccountsFailure(
            defaultLocale,
            3,
            errors,
        );

        expect(result).toBe(
            "Successfully invited 3 people. fail1@example.com, fail2@example.com, fail3@example.com, " +
                "and 2 others couldn\u2019t be invited due to an unexpected error. inv1@, inv2@, inv3@, and 1 other " +
                "aren\u2019t valid email addresses. spam1@example.com, spam2@example.com, spam3@example.com, " +
                "and 3 others rejected a previous invite. member1@example.com, member2@example.com, " +
                "member3@example.com, and 2 others are already members of the space.",
        );
    });
});
