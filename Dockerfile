FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY engine/package.json ./engine/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm ci; else npm ci; fi
COPY tsconfig.json tsconfig.build.json ./
COPY engine ./engine
COPY server ./server
COPY web ./web
RUN npm run build && npm run build:server

FROM build AS dependencies
RUN npm prune --omit=dev --ignore-scripts --offline

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY engine/package.json ./engine/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./dist/web/dist
COPY server/migrations ./dist/server/migrations
COPY server/policies ./dist/server/policies
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/src/main.js"]
