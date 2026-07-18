FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ src/
RUN mkdir -p /app/uploads && chown -R node:node /app

ENV NODE_ENV=production
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/ready || exit 1
CMD ["node", "src/server.js"]
