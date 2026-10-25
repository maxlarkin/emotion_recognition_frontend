# syntax=docker/dockerfile:1
# Build the SPA with Node, serve it with nginx. No runtime npm installs.
FROM node:22.23.3-alpine3.24 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
    && if grep -rEo "https?://[^\"' )]*" dist | grep -vE "https?://www\.w3\.org/"; then \
         echo "external URL found in dist/" >&2; exit 1; \
       fi

FROM nginx:1.31.6-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
