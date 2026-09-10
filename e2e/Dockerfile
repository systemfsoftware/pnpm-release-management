FROM docker.io/library/node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq openssl unzip \
  && rm -rf /var/lib/apt/lists/*

ARG DENO_VERSION=2.9.5
RUN curl -fsSL -O \
      "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
  && curl -fsSL -o "deno-x86_64-unknown-linux-gnu.zip.sha256sum" \
      "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip.sha256sum" \
  && sha256sum -c "deno-x86_64-unknown-linux-gnu.zip.sha256sum" \
  && unzip -q "deno-x86_64-unknown-linux-gnu.zip" -d /usr/local/bin \
  && chmod 0755 /usr/local/bin/deno \
  && rm -f "deno-x86_64-unknown-linux-gnu.zip" "deno-x86_64-unknown-linux-gnu.zip.sha256sum"

ARG PROCESS_COMPOSE_VERSION=1.122.0
RUN curl -fsSL -O \
      "https://github.com/F1bonacc1/process-compose/releases/download/v${PROCESS_COMPOSE_VERSION}/process-compose_linux_amd64.tar.gz" \
  && curl -fsSL -o process-compose_checksums.txt \
      "https://github.com/F1bonacc1/process-compose/releases/download/v${PROCESS_COMPOSE_VERSION}/process-compose_checksums.txt" \
  && grep ' process-compose_linux_amd64.tar.gz$' process-compose_checksums.txt | sha256sum -c - \
  && tar -xzf process-compose_linux_amd64.tar.gz -C /usr/local/bin process-compose \
  && rm -f process-compose_linux_amd64.tar.gz process-compose_checksums.txt

ARG VERDACCIO_VERSION=6.10.3
ARG EMULATE_VERSION=0.11.1
RUN npm install -g --no-fund --no-audit "verdaccio@${VERDACCIO_VERSION}" "emulate@${EMULATE_VERSION}" \
  && npm cache clean --force

ARG PNPM_VERSION=11.21.0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

RUN mkdir -p /e2e \
  && printf 'subjectAltName=DNS:api.github.com,DNS:registry.npmjs.org\n' > /e2e/san.cnf \
  && openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
      -keyout /e2e/ca.key -out /e2e/ca.crt -subj '/CN=prm-e2e-ca' \
  && openssl req -newkey rsa:2048 -sha256 -nodes \
      -keyout /e2e/server.key -out /e2e/server.csr -subj '/CN=api.github.com' \
  && openssl x509 -req -in /e2e/server.csr -CA /e2e/ca.crt -CAkey /e2e/ca.key -CAcreateserial \
      -out /e2e/server.crt -days 3650 -sha256 -extfile /e2e/san.cnf \
  && cp /e2e/ca.crt /usr/local/share/ca-certificates/prm-e2e.crt \
  && update-ca-certificates \
  && rm -f /e2e/server.csr /e2e/ca.srl

ENV DENO_TLS_CA_STORE=system \
    NODE_EXTRA_CA_CERTS=/e2e/ca.crt

COPY e2e/verdaccio.yaml /e2e/verdaccio.yaml
COPY e2e/process-compose.yaml /e2e/process-compose.yaml
COPY e2e/tls-proxy.ts /e2e/tls-proxy.ts

COPY deno.json deno.lock /prm-seed/
COPY apps packages /prm-seed/
RUN cd /prm-seed && deno cache apps/*/main.ts && rm -rf /prm-seed

CMD ["process-compose", "--config", "/e2e/process-compose.yaml", "up", "--no-server", "--tui=false"]
