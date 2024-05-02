import {useMemo} from "react";
import {useClientInfo} from "~/client/remix/client_info_context.js";

/**
 * Format a number as a human readable string. In English adds thousands
 * commas. For example `3000` becomes "3,000".
 *
 * You can add a label which will be pluralized with English pluralization
 * rules. For example passing in 1 and a label of "book" will give you "1 book"
 * but passing in 5000 and "book" will give you "5,000 books". You can
 * customize the pluralized form of the string with `pluralLabel`. By default
 * we add an "s" and don't try any other pluralization rules.
 */
export function usePrettyNumber({
    number,
    label,
    pluralLabel,
}: {
    number: number;
    label?: string;
    pluralLabel?: string;
}): string {
    const {locale} = useClientInfo();

    const prettyNumber = useMemo(() => {
        const formatter = new Intl.NumberFormat(locale, {
            notation: "standard",
            style: "decimal",
        });

        return formatter.format(number);
    }, [locale, number]);

    return `${prettyNumber}${
        typeof label === "string" ? ` ${number === 1 ? label : pluralLabel ?? `${label}s`}` : ""
    }`;
}

/**
 * Format a number as a human readable string. In English adds thousands
 * commas. For example `3000` becomes "3,000".
 *
 * You can add a label which will be pluralized with English pluralization
 * rules. For example passing in 1 and a label of "book" will give you "1 book"
 * but passing in 5000 and "book" will give you "5,000 books". You can
 * customize the pluralized form of the string with `pluralLabel`. By default
 * we add an "s" and don't try any other pluralization rules.
 *
 * Component form of `usePrettyNumber()` as a convenience. Useful if you need
 * to use behind a condition.
 */
export function PrettyNumber(props: {number: number; label?: string; pluralLabel?: string}) {
    return <>{usePrettyNumber(props)}</>;
}

/**
 * Print the summary of a small number. If the number is greater than 10 we'll
 * print 10+, if it's greater than 20 we'll print 20+, and so on up until 100.
 * We recommend using a small number summary if the exact number isn't
 * important but you still want to give the user a sense of the number's scale.
 *
 * Design wise, we like rounding to the nearest tenth since the reader's brain
 * will more quickly interpret 30+ as compared to 32.
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
