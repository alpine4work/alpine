export function generateEmailAddressForDevConsole(
    baseEmailAddress: string = `test@test.cyberworlds.dev`,
) {
    const currentTime = new Date();

    const [emailAddressPart1, emailAddressPart2] = baseEmailAddress.split("@", 2);

    const emailAddressTime =
        currentTime.getFullYear().toString().padStart(4, "0") +
        "." +
        (currentTime.getMonth() + 1).toString().padStart(2, "0") +
        "." +
        currentTime.getDate().toString().padStart(2, "0") +
        "." +
        // Seconds through the day. We use this format instead of `hh.mm.ss` so the date
        // clearly reads as a date. Seconds are added on purely to disambiguate.
        (
            currentTime.getHours() * 60 * 60 +
            currentTime.getMinutes() * 60 +
            currentTime.getSeconds()
        )
            .toString()
            .padStart(5, "0");

    return `${emailAddressPart1}+${emailAddressTime}@${emailAddressPart2}`;
}
