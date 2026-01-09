import {EmailAddress, isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {Schema} from "~/shared/schema/schema.js";

export const EmailAddressSchema: Schema<EmailAddress> = Schema.string
    .minLength(1)
    // https://stackoverflow.com/questions/386294/what-is-the-maximum-length-of-a-valid-email-address
    .maxLength(254)
    .validation("Expected string to be an email address", isEmailAddressValid);
