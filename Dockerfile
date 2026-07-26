FROM node:20-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client qemu-system-x86 qemu-utils \
  && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY .env.example ./
COPY start.js ./
COPY src ./src
COPY scripts ./scripts
COPY config/*.example.json ./config/

RUN mkdir -p /app/config /app/keys /app/s12ryt /app/vm \
  && chown -R node:node /app

USER node
EXPOSE 2222 2223

CMD ["node", "start.js"]
