FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache unzip

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "src/server.js"]
