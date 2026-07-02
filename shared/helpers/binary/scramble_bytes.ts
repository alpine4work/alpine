/**
 * Ad hoc reversible byte diffusion routine: hash - derived state, add a mask byte,
 * feed the scrambled byte back into state, then do a reverse-direction pass.
 * Written by GPT-5.5 (Extra High).
 */
// Reasoning why GPT-5.5 picked its constants:
//
// - `0x9e37_79b9` comes from the golden ratio scaled to 32 bits. It's widely used
//   for hash mixing, Weyl sequences, and stepping through 32-bit state because it
//   distributes increments well.
//
// - `0x85eb_ca6b` is one of MurmurHash3's finalizer constants.
//
// - `0x7feb_352d` and `0x846c_a68b` are common constants from a public-domain-ish
//   32-bit integer finalizer often referred to as hash32shift/lowbias32 style
//   mixing. They're used because they have decent avalanche behavior for 32-bit
//   inputs.
export function scrambleBytes(bytes: Uint8Array, seed: number): Uint8Array {
    const out = Uint8Array.from(bytes);

    // Forward pass.
    //
    // Each byte gets a mask byte derived from:
    //
    // - the seed,
    // - the byte position,
    // - previously scrambled bytes.
    //
    // Because state incorporates the scrambled byte, changing one early byte affects
    // later bytes too.
    let state = mix32(seed ^ 0x9e37_79b9);

    for (let i = 0; i < out.length; i++) {
        state = mix32(state + i);
        out[i] = (out[i]! + (state & 0xff)) & 0xff;
        state = mix32(state ^ out[i]!);
    }

    // Backward pass.
    //
    // This gives later bytes a chance to affect earlier bytes too.
    state = mix32(seed ^ 0x85eb_ca6b);

    for (let i = out.length - 1; i >= 0; i--) {
        state = mix32(state + i);
        out[i] = (out[i]! + (state & 0xff)) & 0xff;
        state = mix32(state ^ out[i]!);
    }

    return out;
}

/**
 * Unscrambles bytes previously scrambled by `scrambleBytes()`.
 */
export function unscrambleBytes(bytes: Uint8Array, seed: number): Uint8Array {
    const out = Uint8Array.from(bytes);

    // Reverse the scramble exactly:
    //
    // - backward pass is undone first,
    // - forward pass is undone second,
    // - byte addition is reversed with subtraction.

    let state = mix32(seed ^ 0x85eb_ca6b);

    for (let i = out.length - 1; i >= 0; i--) {
        state = mix32(state + i);

        // Save the scrambled byte because scramble() used that byte to update state after
        // applying the mask.
        const byte = out[i]!;

        out[i] = (byte - (state & 0xff) + 256) & 0xff;
        state = mix32(state ^ byte);
    }

    state = mix32(seed ^ 0x9e37_79b9);

    for (let i = 0; i < out.length; i++) {
        state = mix32(state + i);

        const byte = out[i]!;

        out[i] = (byte - (state & 0xff) + 256) & 0xff;
        state = mix32(state ^ byte);
    }

    return out;
}

function mix32(value: number): number {
    // A small avalanche-style 32-bit mixer.
    //
    // Nearby inputs tend to produce very different outputs, which is useful for making
    // adjacent version/pos values look unrelated after scrambling.
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb_352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846c_a68b);
    x ^= x >>> 16;
    return x >>> 0;
}
