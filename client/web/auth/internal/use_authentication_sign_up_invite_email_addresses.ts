import {useCallback} from "react";
import {removeLocalStorage, useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {Schema} from "~/shared/schema/schema.js";

const AuthenticationSignUpInviteEmailAddressesSchema = Schema.array(Schema.string);

export const authenticationSignUpInviteEmailAddressMinCount = 3;
export const authenticationSignUpInviteEmailAddressMaxCount = 10;

const initialAuthenticationSignUpInviteEmailAddresses = createArrayWithLength(
    authenticationSignUpInviteEmailAddressMinCount,
    () => "",
);

function getAuthenticationSignUpInviteEmailAddressesLocalStorageKey(emailAddress: EmailAddress) {
    return `cyberworlds/signUp/${encodeURIComponent(emailAddress)}/inviteEmailAddresses`;
}

/**
 * We store the email address state for `<AuthenticationSignUpInviteView>` in
 * `localStorage` so if the user refreshes their browser they don't lose the email
 * addresses they added (which may have taken some effort to type in).
 *
 * We will clear this state when the user finishes signing up.
 */
export function useAuthenticationSignUpInviteEmailAddresses(emailAddress: EmailAddress) {
    const [inviteEmailAddresses, actuallySetInviteEmailAddresses] = useLocalStorage(
        getAuthenticationSignUpInviteEmailAddressesLocalStorageKey(emailAddress),
        AuthenticationSignUpInviteEmailAddressesSchema,
        initialAuthenticationSignUpInviteEmailAddresses,
    );

    const setInviteEmailAddresses = useCallback(
        (inviteEmailAddresses: ReadonlyArray<string>) => {
            assert(inviteEmailAddresses.length >= authenticationSignUpInviteEmailAddressMinCount);
            assert(inviteEmailAddresses.length <= authenticationSignUpInviteEmailAddressMaxCount);
            actuallySetInviteEmailAddresses(inviteEmailAddresses);
        },
        [actuallySetInviteEmailAddresses],
    );

    return [inviteEmailAddresses, setInviteEmailAddresses] as const;
}

export function removeAuthenticationSignUpInviteEmailAddresses(emailAddress: EmailAddress) {
    removeLocalStorage(getAuthenticationSignUpInviteEmailAddressesLocalStorageKey(emailAddress));
}
