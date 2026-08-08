import {EmailAddress, isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

// https://stackoverflow.com/questions/386294/what-is-the-maximum-length-of-a-valid-email-address
export const emailAddressMaxLength = 254;

export const EmailAddressSchema: Schema<EmailAddress> = Schema.string
    .minLength(1)
    .maxLength(emailAddressMaxLength)
    .validation("Expected string to be an email address", isEmailAddressValid);
