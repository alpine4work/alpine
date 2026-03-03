/**
 * Generates a random one time password. A one time password is 6 characters, where
 * each character is a digit from 0 to 9.
 *
 * There are 1 million possibilities so an attacker has a 0.000005% chance to guess
 * the password. We only allow 5 attempts to guess before locking the account.
 */
export function generateOneTimePassword(): string {
    const randomUint32s = new Uint32Array(6);
    crypto.getRandomValues(randomUint32s);

    const randomDigits = randomUint32s.map(randomUint32 => {
        // Convert a uint32 to a float. We divide by 0xffffffff since that's the maximum
        // uint32 value. We add 1 so that our float is in the range [0, 1) (0 inclusive, 1
        // exclusive).
        const randomFloat = randomUint32 / (0xffffffff + 1);

        return Math.floor(randomFloat * 10);
    });

    return randomDigits.join("");
}
