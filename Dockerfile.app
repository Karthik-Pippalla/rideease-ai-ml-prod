FROM node:22-bookworm AS base
WORKDIR /app/functions
COPY functions/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app/functions
COPY --from=base /app/functions/node_modules ./node_modules
COPY functions ./
RUN useradd --user-group --system rideease && chown -R rideease:rideease /app
USER rideease:rideease
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s CMD node pipeline/healthcheck.js || exit 1
CMD ["node", "pipeline/server.js"]
