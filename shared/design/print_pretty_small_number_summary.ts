/**
 * Print the summary of a small number. If the number is greater than 10 we'll
 * print 10+, if it's greater than 20 we'll print 20+, and so on up until 100. We
 * recommend using a small number summary if the exact number isn't important but
 * you still want to give the user a sense of the number's scale.
 *
 * Design wise, we like rounding to the nearest tenth since the reader's brain will
 * more quickly interpret 30+ as compared to 32.
 */
export function printPrettySmallNumberSummary(
    number: number,
    label: string,
    {
        startOfSentenceSingularLabel = label.slice(0, 1).toUpperCase() + label.slice(1),
        pluralLabel = `${label}s`,
    }: {
        startOfSentenceSingularLabel?: string;
        pluralLabel?: string;
    } = {},
) {
    if (number === 1) {
        return startOfSentenceSingularLabel;
    } else if (number === 100) {
        return `100 ${pluralLabel}`;
    } else if (number > 100) {
        return `100+ ${pluralLabel}`;
    } else if (number > 10) {
        const numberTenth = number / 10;
        const numberTenthDigit = Math.floor(numberTenth);
        return `${numberTenthDigit}0${numberTenth !== numberTenthDigit ? "+" : ""} ${pluralLabel}`;
    } else {
        return `${Math.floor(number)} ${pluralLabel}`;
    }
}
