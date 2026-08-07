import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";

test("can not manually create an error display message", () => {
    // @ts-expect-error: Must use `errorDisplayMessage()` to create error messages
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const message1: ErrorDisplayMessage = [];

    // @ts-expect-error: Must use `errorDisplayMessage()` to create error messages
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const message2: ErrorDisplayMessage = [{type: "Text", text: "Hello, world!"}];
});
