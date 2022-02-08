FROM node:14-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --only=production

COPY index.js .
COPY cert/ ./cert

EXPOSE 25
EXPOSE 1080

CMD npm start
