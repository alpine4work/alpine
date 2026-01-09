import {validateEmailAddressForAuthentication} from "~/client/web/auth/internal/validate_email_address_for_authentication.js";

test("returns `isEmailAddressValid: false` for empty string", () => {
    const result = validateEmailAddressForAuthentication("");
    expect(result.isEmailAddressValid).toEqual(false);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressValid: false` for string without @", () => {
    const result = validateEmailAddressForAuthentication("invalid-email");
    expect(result.isEmailAddressValid).toEqual(false);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressValid: false` for string with @ but no domain", () => {
    const result = validateEmailAddressForAuthentication("user@");
    expect(result.isEmailAddressValid).toEqual(false);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressValid: false` for string with @ but no dot in domain", () => {
    const result = validateEmailAddressForAuthentication("user@domain");
    expect(result.isEmailAddressValid).toEqual(false);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressValid: true` for valid email with work domain", () => {
    const result = validateEmailAddressForAuthentication("user@company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressValid: true` for valid email with subdomain", () => {
    // The function checks the part before the first dot, so "mail" might be generic
    // Use a subdomain that's definitely not generic
    const result = validateEmailAddressForAuthentication("user@internal.company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressPossiblyGeneric: true` for gmail.com email", () => {
    const result = validateEmailAddressForAuthentication("user@gmail.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for gmail.com email with uppercase", () => {
    const result = validateEmailAddressForAuthentication("user@GMAIL.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for gmail.com email with mixed case", () => {
    const result = validateEmailAddressForAuthentication("user@GmAiL.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for yahoo.com email", () => {
    const result = validateEmailAddressForAuthentication("user@yahoo.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for hotmail.com email", () => {
    const result = validateEmailAddressForAuthentication("user@hotmail.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for outlook.com email", () => {
    const result = validateEmailAddressForAuthentication("user@outlook.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for hey.com email (manually added domain)", () => {
    const result = validateEmailAddressForAuthentication("user@hey.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for hey.com email with uppercase", () => {
    const result = validateEmailAddressForAuthentication("user@HEY.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: true` for work domain that starts with generic name", () => {
    // The function only checks the part before the first dot, so "gmail" is checked
    // and since "gmail" is in the generic list, this returns true
    const result = validateEmailAddressForAuthentication("user@gmail.company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("returns `isEmailAddressPossiblyGeneric: false` for work domain with subdomain", () => {
    // Use a subdomain that's definitely not generic
    const result = validateEmailAddressForAuthentication("user@internal.company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressPossiblyGeneric: false` for custom work domain", () => {
    const result = validateEmailAddressForAuthentication("user@acme.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("returns `isEmailAddressPossiblyGeneric: false` for work domain with multiple subdomains", () => {
    // Use a subdomain that's definitely not generic
    const result = validateEmailAddressForAuthentication("user@internal.subdomain.company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with plus sign in local part", () => {
    const result = validateEmailAddressForAuthentication("user+tag@gmail.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("handles email with dots in local part", () => {
    const result = validateEmailAddressForAuthentication("first.last@company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with numbers in domain", () => {
    const result = validateEmailAddressForAuthentication("user@company123.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with hyphens in domain", () => {
    const result = validateEmailAddressForAuthentication("user@my-company.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with country code TLD", () => {
    const result = validateEmailAddressForAuthentication("user@company.co.uk");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with generic domain and country code TLD", () => {
    const result = validateEmailAddressForAuthentication("user@hotmail.co.uk");
    expect(result.isEmailAddressValid).toEqual(true);
    // Only checks the part before the first dot, so "hotmail" is generic
    expect(result.isEmailAddressPossiblyGeneric).toEqual(true);
});

test("handles email with multiple @ symbols (invalid format)", () => {
    // The function only splits on the first @, so "user@domain@invalid.com" becomes "domain@invalid.com"
    // However, the validation logic may not handle this edge case correctly
    // The function returns false for this invalid format
    const result = validateEmailAddressForAuthentication("user@domain@invalid.com");
    expect(result.isEmailAddressValid).toEqual(false);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with only @ symbol", () => {
    const result = validateEmailAddressForAuthentication("@");
    expect(result.isEmailAddressValid).toEqual(false);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with @ and dot but no domain before dot (still considered valid)", () => {
    // The function only checks for @ followed by ., not full email validation
    const result = validateEmailAddressForAuthentication("user@.com");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});

test("handles email with @ and dot but no domain after dot (still considered valid)", () => {
    // The function only checks for @ followed by ., not full email validation
    const result = validateEmailAddressForAuthentication("user@domain.");
    expect(result.isEmailAddressValid).toEqual(true);
    expect(result.isEmailAddressPossiblyGeneric).toEqual(false);
});
