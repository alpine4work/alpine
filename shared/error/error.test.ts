import {
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    UnknownError,
} from "~/shared/error/error.js";

test("can create an error of a specific code using the from method", () => {
    // eslint-disable-next-line cyberworlds/no-global-error
    const error1 = new Error("test");
    const error2 = new FailedPreconditionError("test");
    const error3 = {a: 1, b: 2, c: 3};

    expect(InternalError.from(error1)).toBeInstanceOf(InternalError);
    expect(InternalError.from(error2)).toBeInstanceOf(InternalError);
    expect(InternalError.from(error3)).toBeInstanceOf(InternalError);

    expect(FailedPreconditionError.from(error1)).toBeInstanceOf(FailedPreconditionError);
    expect(FailedPreconditionError.from(error2)).toBeInstanceOf(FailedPreconditionError);
    expect(FailedPreconditionError.from(error3)).toBeInstanceOf(FailedPreconditionError);

    expect(ErrorBase.from(error1)).toBeInstanceOf(UnknownError);
    expect(ErrorBase.from(error2)).toBeInstanceOf(UnknownError);
    expect(ErrorBase.from(error3)).toBeInstanceOf(UnknownError);
});
