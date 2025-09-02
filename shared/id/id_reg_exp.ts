/**
 * A regular expression that matches all `Id`s. If a string matches this regex
 * then it's also a valid `Id`.
 */
export const idRegExp = /[0-9abcdefghjkmnpqrstvwxyz]{25}[0-9abcdefghjkmnpqrstvw]/;

/**
 * A regular expression that matches all `Id`s. If a string matches this regex
 * then it's also a valid `Id`.
 *
 * The string can't contain anything except for the `Id`. (Which is why we have
 * the name "exclusive").
 */
export const idExclusiveRegExp = new RegExp("^" + idRegExp.source + "$");
