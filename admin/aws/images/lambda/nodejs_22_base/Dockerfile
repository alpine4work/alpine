FROM node:22-bookworm@sha256:3266bc9e8bee1acc8a77386eefaf574987d2729b8c5ec35b0dbd6ddbc40b0ce2 AS nodebase

# Ubuntu base you provided (pinned by digest)
FROM ubuntu@sha256:99c35190e22d294cdace2783ac55effc69d32896daaa265f0bbedbcde4fbe3e5

# Copy only the Node runtime from node image
COPY --from=nodebase /usr/local/ /usr/local/
ENV PATH="/usr/local/bin:${PATH}"

ENV LAMBDA_TASK_ROOT=/var/task \
    LAMBDA_RUNTIME_DIR=/var/runtime \
    NODE_ENV=production \
    NPM_CONFIG_CACHE=/tmp/.npm

# Avoid interactive apt prompts
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

RUN apt-get update && \
    apt-get install -y \
    g++ \
    make \
    cmake \
    unzip \
    libcurl4-openssl-dev

# Install Node.js dependencies
# RUN npm install
RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf automake libtool pkg-config \
 && rm -rf /var/lib/apt/lists/*

# Install python3-setuptools for node-gyp compatibility (provides distutils)
RUN apt-get update && apt-get install -y --no-install-recommends python3-setuptools python3-dev && rm -rf /var/lib/apt/lists/*

# Install the runtime interface client
RUN npm install -g aws-lambda-ric

# # Non-root user and standard Lambda workdir
# RUN useradd -m -u 10001 lambda \
#  && mkdir -p /var/task \
#  && chown -R lambda:lambda /var/task
# WORKDIR /var/task
# USER lambda

# Simple entrypoint that uses RIE locally and RIC on Lambda
# (You’ll supply the handler via CMD or at deploy time)
# COPY --chown=lambda:lambda aws-lambda-entrypoint.sh /usr/local/bin/aws-lambda-entrypoint.sh
# RUN chmod +x /usr/local/bin/aws-lambda-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/npx", "aws-lambda-ric"]
