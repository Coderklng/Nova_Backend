FROM node:22-slim

WORKDIR /nova-server

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "run", "dev"]