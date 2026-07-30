def zig_target_cpu_flags():
    return """
# AWS Lambda ARM64 runs on Graviton2/Neoverse N1. Pin Linux AArch64 builds so
# newer Graviton build runners don't emit instructions unavailable in Lambda.
target_cpu_flags=""
if [ "$$(uname -s)" = "Linux" ] && [ "$$(uname -m)" = "aarch64" ]; then
    target_cpu_flags=" -mcpu=neoverse_n1"
fi

export CFLAGS+="$$target_cpu_flags"
export CXXFLAGS+="$$target_cpu_flags"
"""
