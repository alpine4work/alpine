/**
 * Is the user on the MacOS operating system?
 */
export const isMac: boolean =
    typeof navigator !== "undefined" ? /Mac/.test(navigator.platform) : false;
