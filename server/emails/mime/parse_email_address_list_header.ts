import type {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";

const asciiDoubleQuote = String.fromCharCode(34);

/**
 * Splits an RFC 5322 `address-list` style header value on commas that separate
 * mailboxes. Commas inside double-quoted strings (with `\` escapes) and commas
 * inside `<...>` are not separators.
 *
 * Does not implement RFC 5322 `comment` parentheses, obs-route, or nested groups
 * beyond skipping empty groups in `parseEmailAddressListHeader`.
 */
export function splitEmailAddressListHeader(value: string): Array<string> {
    const mailboxSegments: Array<string> = [];
    let currentSegmentStartIndex = 0;
    let isInsideQuotedDisplayName = false;
    let consumeNextCharacterAsQuotedStringEscape = false;
    let angleBracketNestingDepthOutsideQuotes = 0;

    for (let characterIndex = 0; characterIndex < value.length; characterIndex++) {
        const currentCharacter = value[characterIndex]!;

        if (consumeNextCharacterAsQuotedStringEscape) {
            consumeNextCharacterAsQuotedStringEscape = false;
            continue;
        }

        if (isInsideQuotedDisplayName) {
            if (currentCharacter === "\\") {
                consumeNextCharacterAsQuotedStringEscape = true;
            } else if (currentCharacter === asciiDoubleQuote) {
                isInsideQuotedDisplayName = false;
            }
            continue;
        }

        if (currentCharacter === asciiDoubleQuote) {
            isInsideQuotedDisplayName = true;
            continue;
        }

        if (currentCharacter === "<") {
            angleBracketNestingDepthOutsideQuotes++;
            continue;
        }

        if (currentCharacter === ">") {
            if (angleBracketNestingDepthOutsideQuotes > 0) {
                angleBracketNestingDepthOutsideQuotes--;
            }
            continue;
        }

        const isCommaSeparatingMailboxesOutsideAngleAddrs =
            currentCharacter === "," && angleBracketNestingDepthOutsideQuotes === 0;

        if (isCommaSeparatingMailboxesOutsideAngleAddrs) {
            mailboxSegments.push(value.slice(currentSegmentStartIndex, characterIndex));
            currentSegmentStartIndex = characterIndex + 1;
        }
    }

    mailboxSegments.push(value.slice(currentSegmentStartIndex));
    return mailboxSegments
        .map(trimmedSegment => trimmedSegment.trim())
        .filter(trimmedSegment => trimmedSegment.length > 0);
}

/**
 * Returns true when the segment looks like an RFC 5322 `group` with no mailboxes
 * (e.g. `undisclosed-recipients:;`). Segments that contain `@` are never treated
 * as empty groups.
 */
function isEmptyGroupAddressListSegment(segment: string): boolean {
    const t = segment.trim();
    if (t.includes("@")) {
        return false;
    }
    return /^[\s\S]+:\s*;\s*$/.test(t);
}

/**
 * Extracts `addr-spec` from one address-list item: substring between the last `<`
 * and the following `>`, or the whole trimmed item if there is no angle-addr.
 * Strips one pair of surrounding ASCII double quotes from the addr-spec if
 * present.
 */
export function extractAddrSpecFromAddressListItem(segment: string): string {
    const t = segment.trim();
    const lastLt = t.lastIndexOf("<");
    const gtAfter = lastLt === -1 ? -1 : t.indexOf(">", lastLt + 1);
    const spec = lastLt !== -1 && gtAfter !== -1 ? t.slice(lastLt + 1, gtAfter).trim() : t;
    const u = spec.trim();
    if (u.length >= 2 && u.startsWith(asciiDoubleQuote) && u.endsWith(asciiDoubleQuote)) {
        return u.slice(1, -1).trim();
    }
    return spec;
}

/**
 * Parses a decoded To/Cc/Bcc header value into validated `EmailAddress` values.
 * Skips empty RFC 5322 groups (no addresses). Throws `InvalidArgumentError` if any
 * non-skipped segment is not a valid addr-spec.
 */
export function parseEmailAddressListHeader(value: string): Array<EmailAddress> {
    if (value.trim() === "") {
        return [];
    }
    const result: Array<EmailAddress> = [];
    for (const segment of splitEmailAddressListHeader(value)) {
        if (isEmptyGroupAddressListSegment(segment)) {
            continue;
        }
        const spec = extractAddrSpecFromAddressListItem(segment);
        result.push(validateEmailAddress(spec));
    }
    return result;
}
