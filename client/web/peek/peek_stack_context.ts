import {useContext} from "react";
import {PeekStackContextDefinition} from "~/client/web/peek/internal/peek_stack_context_definition.js";
import {PeekStackContext} from "~/client/web/peek/peek_stack_context_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const mockPeekStackContextForTest: PeekStackContext | null = import.meta.jest
    ? {
          push: () => {
              throw new InternalError(
                  "Can not push peeks in tests unless you render your component in `<PeekStackContext>`",
              );
          },
      }
    : null;

export function usePeekStackContext(): PeekStackContext {
    const peekStackContext = useContext(PeekStackContextDefinition);

    // Provide a mock context implementation in unit tests so components don't throw.
    if (import.meta.jest && mockPeekStackContextForTest) return mockPeekStackContextForTest;

    assert(peekStackContext, "Must render in a `<PeekStackContext>` to use peeks");

    return peekStackContext;
}

export function usePeekStackContextIfExists(): PeekStackContext | null {
    const peekStackContext = useContext(PeekStackContextDefinition);

    // Provide a mock context implementation in unit tests so components don't throw.
    if (import.meta.jest && mockPeekStackContextForTest) return mockPeekStackContextForTest;

    return peekStackContext;
}
