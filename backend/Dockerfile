# ── Backend: Express API ─────────────────────────────────────────────────
FROM node:lts

WORKDIR /app

# Install deps first so Docker can cache this layer whenever only source
# files change (not package.json) — much faster rebuilds while learning.
COPY package*.json ./
RUN npm install --omit=dev

# Now copy the rest of the backend source
COPY . .

# Render/production sets PORT itself; default to 5000 for local Docker use
ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
