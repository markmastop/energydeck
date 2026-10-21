FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node *.mjs ./
COPY --chown=node:node public ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:8080/healthz'); process.exit(r.ok ? 0 : 1)"]
CMD ["node", "server.mjs"]
