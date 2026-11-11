# The Delio connector, published as ghcr.io/braand-web/delio-connector for linux/amd64 and linux/arm64. It runs on
# a server of its owner's with the Docker socket, its state volume and /etc/delio (read-only), and talks only outward.
# Node runs its TypeScript as it is; it has no npm dependencies. bubblewrap is here only for the box probe, which runs
# from this image with the home's own security settings.
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && bwrap --version
WORKDIR /app
COPY package.json ./package.json
COPY profiles ./profiles
COPY host ./host
COPY install.sh ./install.sh
COPY src ./src
RUN printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/src/main.ts "$@"\n' > /usr/local/bin/delio-connector \
  && chmod 0755 /usr/local/bin/delio-connector \
  && chmod -R go-w /app \
  && delio-connector version
ENV NODE_ENV=production
USER root
ENTRYPOINT ["delio-connector"]
CMD ["run"]
