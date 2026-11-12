# Two stages: the first builds the web UI, the final image carries the server and the built UI only.
# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop.
# The image holds no tenant value and no secret. Real is off unless the owner passes PRIVILEGE_EXPLORER_MODE=real at run time.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts -w web --include-workspace-root=false && npm cache clean --force
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7813 PAE_DATA_DIR=/data
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
# The diagrams are diagram-studio/1 data files, validated when the server starts: the image must carry them.
COPY server/diagrams server/diagrams
COPY --from=web /app/web/dist web/dist
# The data dir holds the saved connections (mode 600 file, including worker secrets) and the audit log: mode 700, owned by the non-root user.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 7813
VOLUME /data
# Inside the container the server must listen on all interfaces, so PAE_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely: Real can act on the Privilege console.
ENV PAE_BIND=0.0.0.0
# PAE_CONTAINER=1 tells the Real loopback-bind guard that this wide bind is the container's (published on 127.0.0.1 only). A host run does not get it.
ENV PAE_CONTAINER=1
CMD ["node", "server/src/index.js"]
