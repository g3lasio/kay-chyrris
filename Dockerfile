# Dockerfile para Chyrris KAI
FROM node:20-alpine

# Instalar pnpm
RUN npm install -g pnpm@10.4.1

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Instalar dependencias
RUN pnpm install --frozen-lockfile

# Copiar el resto del código
COPY . .

# Build de la aplicación
RUN pnpm run build

# Exponer puerto
EXPOSE 5000

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=5000

# Comando de inicio
CMD ["node", "dist/index.js"]
