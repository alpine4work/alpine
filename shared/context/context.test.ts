import {Context} from "~/shared/context/context";
import {InternalError} from "~/shared/error/error";

test("lazily initializes modules once when they are accessed", () => {
    const testModule1 = Symbol();
    const testModule1Initializer = jest.fn(() => testModule1);

    const testModule2 = Symbol();
    const testModule2Initializer = jest.fn(() => testModule2);

    const context = Context.new({
        test1: testModule1Initializer,
        test2: testModule2Initializer,
    });

    expect(testModule1Initializer).toBeCalledTimes(0);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(context.test1()).toEqual(testModule1);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(context.test1()).toEqual(testModule1);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(context.test2()).toEqual(testModule2);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    expect(context.test1()).toEqual(testModule1);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    expect(context.test2()).toEqual(testModule2);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);
});

test("destroy prevents module from being accessed again", () => {
    const testModule1 = Symbol();
    const testModule1Initializer = jest.fn(() => testModule1);

    const testModule2 = Symbol();
    const testModule2Initializer = jest.fn(() => testModule2);

    const context = Context.new({
        test1: testModule1Initializer,
        test2: testModule2Initializer,
    });

    expect(testModule1Initializer).toBeCalledTimes(0);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(context.test1()).toEqual(testModule1);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    context.destroy();

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(() => context.test1()).toThrow(InternalError);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(() => context.test2()).toThrow(InternalError);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);
});

test("context modules can reference each other", () => {
    const testModule1 = Symbol();
    const testModule1Initializer = jest.fn(context => testModule1);

    const testModule2 = Symbol();
    const testModule2Initializer = jest.fn(context => [context.test1(), testModule2]);

    const context = Context.new({
        test1: testModule1Initializer,
        test2: testModule2Initializer,
    });

    expect(testModule1Initializer).toBeCalledTimes(0);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect(context.test2()).toEqual([testModule1, testModule2]);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    expect(context.test1()).toEqual(testModule1);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    expect(context.test2()).toEqual([testModule1, testModule2]);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    expect(testModule1Initializer.mock.calls[0]![0]).toBe(context);
    expect(testModule2Initializer.mock.calls[0]![0]).toBe(context);
});

test("context modules can create a context clone", () => {
    const testModule2 = Symbol();
    const testModule2Initializer = jest.fn(() => testModule2);

    const testModule1Initializer = jest.fn(context => ({
        clone: () => context.clone({test2: testModule2Initializer}),
    }));

    const context = Context.new({
        test1: testModule1Initializer,
    });

    expect("test1" in context).toEqual(true);
    expect("test2" in context).toEqual(false);

    expect(testModule1Initializer).toBeCalledTimes(0);
    expect(testModule2Initializer).toBeCalledTimes(0);

    const clonedContext = context.test1().clone();

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    expect("test1" in clonedContext).toEqual(true);
    expect("test2" in clonedContext).toEqual(true);
    expect(clonedContext.test2()).toEqual(testModule2);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    clonedContext.test1();

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);
});

test("can destroy a cloned context", () => {
    const testModule2 = Symbol();
    const testModule2Initializer = jest.fn(() => testModule2);

    const testModule1Initializer = jest.fn(context => ({
        clone: () => context.clone({test2: testModule2Initializer}),
    }));

    const context = Context.new({
        test1: testModule1Initializer,
    });

    expect(testModule1Initializer).toBeCalledTimes(0);
    expect(testModule2Initializer).toBeCalledTimes(0);

    const clonedContext = context.test1().clone();

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    clonedContext.test1();
    expect(clonedContext.test2()).toEqual(testModule2);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    clonedContext.destroy();
    expect(() => clonedContext.test1()).toThrow(InternalError);
    expect(() => clonedContext.test2()).toThrow(InternalError);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    context.test1();

    context.destroy();

    expect(() => context.test1()).toThrow(InternalError);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);
});

test("destroying a parent context also destroys the child context", () => {
    const testModule2 = Symbol();
    const testModule2Initializer = jest.fn(() => testModule2);

    const testModule1Initializer = jest.fn(context => ({
        clone: () => context.clone({test2: testModule2Initializer}),
    }));

    const context = Context.new({
        test1: testModule1Initializer,
    });

    expect(testModule1Initializer).toBeCalledTimes(0);
    expect(testModule2Initializer).toBeCalledTimes(0);

    const clonedContext = context.test1().clone();

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(0);

    clonedContext.test1();
    expect(clonedContext.test2()).toEqual(testModule2);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);

    context.destroy();
    expect(() => context.test1()).toThrow(InternalError);
    expect(() => clonedContext.test1()).toThrow(InternalError);
    expect(() => clonedContext.test2()).toThrow(InternalError);

    expect(testModule1Initializer).toBeCalledTimes(1);
    expect(testModule2Initializer).toBeCalledTimes(1);
});
