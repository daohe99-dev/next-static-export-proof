FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NO_UPDATE_CHECK=1
COPY runtime/package.json runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build --chown=node:node /app/out ./out
COPY --chown=node:node serve.json ./serve.json
USER node
# serve reads the runtime PORT environment variable; exec-form does not expand $PORT.
CMD ["node", "node_modules/serve/build/main.js", "out", "--config", "../serve.json", "--no-clipboard", "--no-port-switching"]
