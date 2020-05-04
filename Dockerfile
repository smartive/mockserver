FROM node:10

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY index.js .

EXPOSE 25
EXPOSE 1080

ENTRYPOINT [ "npm", "run" ]
CMD [ "start" ]
