import {ErrorDisplayMessage} from "~/shared/error/error_display_message";

test("can not manually create an error display message", () => {
    // @ts-expect-error: Must use `errorDisplayMessage()` to create error messages
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const message1: ErrorDisplayMessage = [];

    // @ts-expect-error: Must use `errorDisplayMessage()` to create error messages
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const message2: ErrorDisplayMessage = [{type: "Text", text: "Hello, world!"}];
});
