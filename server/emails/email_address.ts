import {validate as validateEmail} from "email-validator";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

/**
 * A correctly formatted [email address][1] with a domain that can
 * receive email.
 *
 * If you have a value of this type, you are guaranteed that it is a correctly
 * formatted email. You are also guaranteed that at some point in time the
 * domain had a valid MX DNS record. However, the domain may have removed its
 * MX DNS records since we checked.
 *
 * [1]: https://en.wikipedia.org/wiki/Email_address
 */
// TODO(calebmer): Maybe instead of verifying email address MX DNS records on
// creation, maybe I should verify when sending via `sendEmail`?
export type EmailAddress = string & {readonly _EmailAddress: never};

/**
 * Validates that a string is an email address by checking its formatting and
 * using [1.1.1.1][1] to make a DNS query to check for MX records on the
 * domain.
 *
 * [1]: https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/
 */
export async function validateEmailAddress(
    context: Context<{tracer: TracerContextModule}>,
    emailAddress: string,
): Promise<EmailAddress> {
    // Email address is case-insensitive. So normalize email address.
    emailAddress = emailAddress.toLowerCase();

    if (!validateEmail(emailAddress)) {
        throw new InvalidArgumentError("Expected string to be an email address", {
            displayMessage: errorDisplayMessage`“${emailAddress}” is not an email address. Try again with an email address like “anthony.mose@company.com”.`,
        });
    }

    const domain = emailAddress.split("@", 2)[1]!;

    // In development and test environments, we skip MX DNS record validation for
    // domains we own and know to accept emails (e.g. the `test.cyberworlds.dev`
    // domain). Letting you create any number of these addresses. This is because
    // we don't actually send emails in development and test environments.
    if (
        process.env.NODE_ENV !== "production" &&
        (domain === "alpine.inc" ||
            domain === "cyberworlds.dev" ||
            domain === "test.cyberworlds.dev" ||
            domain.endsWith(".test.cyberworlds.dev"))
    ) {
        return emailAddress as EmailAddress;
    }

    const dnsQueryUrl = new URL("https://1.1.1.1/dns-query");
    dnsQueryUrl.searchParams.set("type", "mx");
    dnsQueryUrl.searchParams.set("name", domain);

    const body = await fetchWithTracer(
        context.tracer.getTracer(),
        dnsQueryUrl,
        {
            serviceName: "Cloudflare 1.1.1.1",
            route: "/dns-query",
            headers: {Accept: "application/dns-json"},
        },
        async response => {
            if (response.status !== 200)
                throw new InternalError(
                    `DNS query for domain MX records failed with status: ${response.status}`,
                );

            return response.json();
        },
    );

    if (body.Status !== 0 || body.Answer.length === 0) {
        throw new InvalidArgumentError("Couldn’t find MX DNS records for email domain", {
            displayMessage: errorDisplayMessage`The domain “${domain}” does not accept emails. Try providing a different email address where you can receive emails.`,
        });
    }

    return emailAddress as EmailAddress;
}

/**
 * Validate that a string is formatted as an email address but we do not check
 * that the domain has an MX DNS record. Use this if you need to synchronously
 * validate an email address.
 *
 * Importantly, we do not cast the type to `EmailAddress`! To have a value of
 * the `EmailAddress` type we should have checked whether the domain has an MX
 * DNS record.
 */
export function validateEmailAddressWithoutCheckingDomainMxDnsRecords(
    emailAddress: string,
): boolean {
    return validateEmail(emailAddress);
}
