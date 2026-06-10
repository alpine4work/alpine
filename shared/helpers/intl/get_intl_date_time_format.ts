import {Locale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

let intlDateTimeFormatByOptions: Map<string, Intl.DateTimeFormat> | undefined;

export type IntlDateTimeFormatOptions = {
    readonly locale: Locale;
    readonly timeZone: TimeZone;
    readonly year?: "numeric" | "2-digit";
    readonly month?: "numeric" | "2-digit" | "long" | "short" | "narrow";
    readonly day?: "numeric" | "2-digit";
    readonly weekday?: "long" | "short" | "narrow";
    readonly hour?: "numeric" | "2-digit";
    readonly minute?: "numeric" | "2-digit";
    readonly second?: "numeric" | "2-digit";
};

/**
 * Through debugging we've found `new Intl.DateTimeFormat()` can be expensive in
 * hot code paths (e.g. `<MessageView>` rendering). This function caches
 * `Intl.DateTimeFormat` objects so we only need to create an object once for a
 * given set of options.
 *
 * It also enforces other best practices like requiring `locale` and `timeZone`
 * options of the right type.
 */
export function getIntlDateTimeFormat({
    locale,
    timeZone,
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
}: IntlDateTimeFormatOptions): Intl.DateTimeFormat {
    intlDateTimeFormatByOptions ??= new Map();

    const optionsString = `${locale},${timeZone},${year ?? ""},${month ?? ""},${day ?? ""},${
        weekday ?? ""
    },${hour ?? ""},${minute ?? ""},${second ?? ""}`;

    let intlDateTimeFormat = intlDateTimeFormatByOptions.get(optionsString);
    if (intlDateTimeFormat === undefined) {
        intlDateTimeFormat = new Intl.DateTimeFormat(locale, {
            timeZone,
            year,
            month,
            day,
            weekday,
            hour,
            minute,
            second,
        });
        intlDateTimeFormatByOptions.set(optionsString, intlDateTimeFormat);
    }

    return intlDateTimeFormat;
}
