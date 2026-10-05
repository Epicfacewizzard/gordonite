# syntax=docker/dockerfile:1
#
# Personal HQ. The server has no npm runtime dependencies (it uses Node's built-in
# SQLite), so the final image only needs the server code and the built client.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY shared ./shared
COPY client ./client
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    HOME_TZ=America/Edmonton
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY --from=build /app/client/dist ./client/dist

# /data holds the database and the automatic backups. Mount a host folder or volume here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
