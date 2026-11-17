FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 as deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --only=production

COPY index.js .
COPY cert/ ./cert

FROM deps

EXPOSE 25
EXPOSE 1080

CMD npm start
