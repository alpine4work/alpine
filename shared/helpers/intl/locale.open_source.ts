/**
 * A locale identifier. For example `en-US`.
 */
export type Locale = string & {readonly _Locale: never};

/**
 * The default locale to use when none is provided.
 */
// TODO(calebmer): Right now we only support the `en-US` locale. Add more to this
// file to find and validate other locales. Possibly using the `Intl` library.
export const defaultLocale = "en-US" as Locale;
