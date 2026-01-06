import {EmailAddress, isEmailAddressValid} from "~/server/emails/email_address.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

/**
 * Schema for validating email addresses stored in DynamoDB.
 *
 * This is an internal schema to DynamoDB! When deserializing we do not check
 * MX DNS records. We can trust the email address in the database has
 * previously been validated because we control all writers to the database and
 * all writers to the database must prove they have an `EmailAddress` type.
 *
 * However, if you use this schema for an API request then a bad client could
 * pass an `EmailAddress` in they did not validate the MX DNS records for which
 * would invalidate the assumptions of the `EmailAddress` type.
 */
export const DynamoEmailAddressSchema = Schema.string
    .minLength(1)
    // https://stackoverflow.com/questions/386294/what-is-the-maximum-length-of-a-valid-email-address
    .maxLength(254)
    .singleLine()
    .transform<EmailAddress>({
        serialize: emailAddress => emailAddress,
        deserialize: emailAddress => {
            // Email address is case-insensitive. So normalize email address.
            emailAddress = emailAddress.toLowerCase();

            if (!isEmailAddressValid(emailAddress))
                throw new SchemaDeserializationError("Expected string to be an email address");

            return emailAddress;
        },
    });
