import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export const notFoundErrorDisplayMessage = errorDisplayMessage`The page you opened could not be found. If you got here from a broken link let us know at ${errorDisplayMessage.supportLink}`;
