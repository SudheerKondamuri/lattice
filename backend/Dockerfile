FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
RUN ./node_modules/.bin/esbuild src/*.ts --outdir=dist/backend/src --platform=node --format=esm
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 libgl1 curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY parser/requirements.txt /app/parser/requirements.txt
RUN python3 -m venv /opt/parser && /opt/parser/bin/pip install --no-cache-dir torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu && /opt/parser/bin/pip install --no-cache-dir -r /app/parser/requirements.txt
# Download public parser artifacts at image-build time, never inside an ingestion request.
RUN /opt/parser/bin/docling-tools models download -o /opt/docling-models layout tableformer rapidocr && chmod -R a+rX /opt/docling-models
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY parser ./dist/backend/parser
COPY migrations ./dist/backend/migrations
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 PARSER_PYTHON=/opt/parser/bin/python HF_HUB_OFFLINE=1
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/backend/src/server.js"]
