/**
 * An algebraic data type for propagating errors without throwing.
 */
export type Result<T, E = unknown> =
    | {
          readonly ok: true;
          readonly value: T;
          readonly error?: undefined;
      }
    | {
          readonly ok: false;
          readonly error: E;
          readonly value?: undefined;
      };
