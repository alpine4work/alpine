FROM docker.io/cloudflare/sandbox:0.12.4

WORKDIR /workspace

RUN npm install \
    --no-save \
    --no-package-lock \
    --omit=dev \
    --no-audit \
    --no-fund \
    @anthropic-ai/claude-agent-sdk@0.3.221 \
    && npm cache clean --force

ADD sandbox_skills.tar.gz /workspace/agent/.claude/skills/
COPY claude_agent_service_bundle.mjs /workspace/claude_agent_service_bundle.mjs

EXPOSE 8080
