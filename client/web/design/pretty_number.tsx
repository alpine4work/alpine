import {useMemo} from "react";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";

/**
 * Format a number as a human readable string. In English adds thousands commas.
 * For example `3000` becomes "3,000".
 *
 * You can add a label which will be pluralized with English pluralization rules.
 * For example passing in 1 and a label of "book" will give you "1 book" but
 * passing in 5000 and "book" will give you "5,000 books". You can customize the
 * pluralized form of the string with `pluralLabel`. By default we add an "s" and
 * don't try any other pluralization rules.
 *
 * Component form of `printPrettyNumber()` as a convenience. Useful if you need to
 * use behind a condition.
 */
export function PrettyNumber({
    number,
    label,
    pluralLabel,
}: {
    number: number;
    label?: string;
    pluralLabel?: string;
}) {
    const {locale} = useClientInfo();

    return useMemo(() => {
        return <>{printPrettyNumber(locale, number, label, {pluralLabel})}</>;
    }, [label, locale, number, pluralLabel]);
}
