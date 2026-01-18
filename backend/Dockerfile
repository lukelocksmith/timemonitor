FROM node:20-alpine

WORKDIR /app

# Zależności dla better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Utwórz katalog na dane
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/activity.db

EXPOSE 3001

CMD ["node", "dist/index.js"]
