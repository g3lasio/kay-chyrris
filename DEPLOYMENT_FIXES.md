# Correcciones de Deployment para Replit

## Problema Identificado

El deployment en Replit fallaba con el siguiente error:
```
Build failed
Your deployment attempt had the following errors:
Run command contains "dev" which is blocked for security reasons as it's not production-ready
Using development server (pnpm run dev) instead of production build for Cloud Run deployment
```

## Causa Raíz

El archivo `.replit` estaba configurado para usar `pnpm dev` en el workflow de inicio, lo cual es un comando de desarrollo que no está optimizado para producción y está bloqueado por razones de seguridad en deployments de Replit.

## Soluciones Implementadas

### 1. Actualización del archivo `.replit`

**Cambios realizados:**

- **Línea 24**: Cambiado de `args = "pnpm dev"` a `args = "pnpm start"`
  - Esto asegura que el workflow de inicio use el comando de producción
  
- **Línea 39**: Mejorado el comando de build de `build = ["pnpm", "run", "build"]` a `build = ["sh", "-c", "pnpm install && pnpm run build"]`
  - Asegura que las dependencias estén instaladas antes del build
  
- **Línea 42**: Añadido `ignorePorts = false`
  - Asegura que Replit respete la configuración de puertos

### 2. Creación de `Dockerfile`

Se creó un Dockerfile para permitir deployments alternativos en Google Cloud Run u otros servicios de contenedores:

- Usa Node.js 20 Alpine (imagen ligera)
- Instala pnpm 10.4.1
- Ejecuta el build completo
- Expone el puerto 5000
- Establece `NODE_ENV=production`

### 3. Creación de `.dockerignore`

Optimiza el build de Docker excluyendo archivos innecesarios:
- node_modules (se reinstalan en el build)
- Archivos de configuración local
- Documentación
- Logs

### 4. Creación de `replit.nix`

Define las dependencias del sistema para Replit:
- Node.js 20
- pnpm

### 5. Actualización de `DEPLOYMENT.md`

Documentación completa actualizada con:
- Instrucciones específicas para deployment en Replit
- Diferenciación clara entre desarrollo local y producción
- Troubleshooting para el error específico
- Instrucciones para Google Cloud Run
- Production checklist

## Verificación de la Configuración

### Scripts de package.json (verificados como correctos):

```json
{
  "dev": "NODE_ENV=development tsx watch server/_core/index.ts",
  "build": "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
  "start": "NODE_ENV=production node dist/index.js"
}
```

- ✅ `dev`: Para desarrollo local con hot-reload
- ✅ `build`: Compila frontend (Vite) y backend (esbuild)
- ✅ `start`: Inicia en modo producción usando el código compilado

### Configuración del servidor (verificada como correcta):

El archivo `server/_core/index.ts`:
- ✅ Detecta correctamente `NODE_ENV` para cambiar entre desarrollo y producción
- ✅ Usa Vite en desarrollo, archivos estáticos en producción
- ✅ Lee el puerto de la variable de entorno `PORT` (default: 5000)
- ✅ Incluye health check endpoints para Cloud Run

## Pasos para el Usuario

### Para hacer deployment en Replit:

1. **Hacer pull de los cambios** desde GitHub:
   ```bash
   git pull origin main
   ```

2. **Verificar que las variables de entorno estén configuradas** en Secrets:
   - `OWLFENC_DATABASE_URL`
   - `LEADPRIME_DATABASE_URL`
   - `STRIPE_SECRET_KEY`
   - `RESEND_API_KEY`

3. **Hacer el build localmente** (opcional, para verificar):
   ```bash
   pnpm install
   pnpm run build
   ```

4. **Usar el botón "Deploy" en Replit** (NO el botón "Run"):
   - Seleccionar "Autoscale" deployment
   - Replit ejecutará automáticamente:
     - `pnpm install && pnpm run build` (build)
     - `node dist/index.js` (run)

### Para desarrollo local en Replit:

```bash
pnpm dev
```

Este comando sigue funcionando para desarrollo local con hot-reload.

## Resultado Esperado

Después de aplicar estos cambios:

1. ✅ El deployment en Replit funcionará sin errores
2. ✅ La aplicación se ejecutará en modo producción optimizado
3. ✅ No habrá advertencias de seguridad sobre comandos de desarrollo
4. ✅ El build será reproducible y consistente
5. ✅ La aplicación estará lista para escalar automáticamente

## Archivos Modificados

- `.replit` - Configuración de Replit actualizada
- `DEPLOYMENT.md` - Documentación actualizada
- `Dockerfile` - Nuevo (para deployments alternativos)
- `.dockerignore` - Nuevo (optimización de Docker)
- `replit.nix` - Nuevo (dependencias del sistema)
- `DEPLOYMENT_FIXES.md` - Este archivo (documentación de cambios)

## Notas Adicionales

- El proyecto ya tenía los scripts correctos en `package.json`
- El servidor ya estaba configurado correctamente para producción
- El único problema era la configuración del workflow en `.replit`
- Todos los cambios son compatibles con versiones anteriores
- El desarrollo local sigue funcionando con `pnpm dev`
