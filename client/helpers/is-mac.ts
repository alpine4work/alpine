/**
 * Is the user on the MacOS operating system?
 */
export const isMac = typeof navigator !== "undefined" ? /Mac/.test(navigator.platform) : false;
