import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";

/**
 * The email address we provide to Apple that lets a reviewer sign into our
 * app and try it out.
 *
 * Try to special case as little as possible for this email address!
 */
export const appleReviewerAccountEmailAddress = validateEmailAddress("apple.reviewer@alpine.inc");
