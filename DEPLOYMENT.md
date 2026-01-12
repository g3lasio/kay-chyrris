# Chyrris KAI - Deployment Guide

## Overview

Chyrris KAI is a **portable web application** that works in any Node.js environment (Replit, Vercel, Railway, Google Cloud Run, etc.). It has **NO dependencies on Manus services** and requires **NO authentication**.

## Features

- ✅ Dashboard with real-time metrics from Owl Fenc database
- ✅ User management (21 users, 12 active subscriptions)
- ✅ Payment tracking with Stripe integration
- ✅ Mass announcements system
- ✅ No authentication required (public access)
- ✅ Works in any environment

## Environment Variables

Configure these in your hosting platform's Secrets/Environment panel:

### Required for Database Access
```
OWLFENC_DATABASE_URL=postgresql://...
LEADPRIME_DATABASE_URL=postgresql://...
```

### Required for Stripe Integration
```
STRIPE_SECRET_KEY=sk_live_...
```

### Required for Email Notifications
```
RESEND_API_KEY=re_...
```

### Optional (for specific features)
```
DATABASE_URL=mysql://...  # If using local database
JWT_SECRET=your-secret-here  # If enabling authentication later
PORT=5000  # Default port (can be changed)
NODE_ENV=production  # Set automatically in production
```

## Deployment Instructions

### Replit (Production Deployment)

**IMPORTANTE**: Para deployment en producción en Replit, sigue estos pasos:

1. **Clone el repositorio**:
   ```bash
   git clone https://github.com/g3lasio/kay-chyrris.git
   cd kay-chyrris
   ```

2. **Configure Secrets**:
   - Click en 🔒 **Secrets** en la barra lateral izquierda
   - Añade todas las variables de entorno requeridas listadas arriba

3. **Instala las dependencias**:
   ```bash
   pnpm install
   ```

4. **Build de la aplicación**:
   ```bash
   pnpm run build
   ```

5. **Para deployment en Replit**:
   - La configuración en `.replit` ya está optimizada para producción
   - El comando `build` ejecuta: `pnpm install && pnpm run build`
   - El comando `run` ejecuta: `node dist/index.js`
   - **NO uses `pnpm dev`** para deployment - esto es solo para desarrollo local

6. **Deploy usando el botón de Deploy**:
   - Click en el botón **Deploy** en Replit
   - Selecciona **Autoscale** deployment
   - Replit ejecutará automáticamente el build y usará el comando de producción

7. **Accede al dashboard**:
   - Una vez deployado, abre la URL de producción
   - Navega a `/` para ver el dashboard

### Replit (Desarrollo Local)

Para desarrollo local en Replit:

```bash
pnpm dev
```

Este comando usa `tsx watch` para hot-reload durante el desarrollo.

### Google Cloud Run

1. **Build y push de la imagen Docker**:
   ```bash
   gcloud builds submit --tag gcr.io/[PROJECT-ID]/chyrris-kai
   ```

2. **Deploy a Cloud Run**:
   ```bash
   gcloud run deploy chyrris-kai \
     --image gcr.io/[PROJECT-ID]/chyrris-kai \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars OWLFENC_DATABASE_URL=[URL],STRIPE_SECRET_KEY=[KEY],RESEND_API_KEY=[KEY]
   ```

### Vercel

1. **Import el repositorio** desde GitHub
2. **Configure Environment Variables** en Project Settings
3. **Build Settings**:
   - Build Command: `pnpm run build`
   - Output Directory: `dist`
   - Install Command: `pnpm install`
4. **Deploy** - Vercel detectará automáticamente la configuración

### Railway

1. **New Project** → Deploy from GitHub
2. **Add Environment Variables** en la pestaña Variables
3. **Deploy Settings**:
   - Build Command: `pnpm run build`
   - Start Command: `pnpm start`
4. **Deploy** - Railway manejará el resto

## Port Configuration

La aplicación usa **port 5000** por defecto. Si tu entorno requiere un puerto diferente:

1. Establece la variable de entorno `PORT`
2. La app la usará automáticamente

## Database Setup

La aplicación se conecta a bases de datos PostgreSQL externas (Neon):

- **Owl Fenc Database**: Datos de usuarios, suscripciones, proyectos
- **LeadPrime Database**: Fuente de datos adicional

No se requiere configuración de base de datos local - solo configura las cadenas de conexión.

## Troubleshooting

### "Run command contains 'dev' which is blocked for security reasons"

Este error ocurre cuando intentas hacer deployment con el comando de desarrollo. **Solución**:

1. Asegúrate de que el archivo `.replit` tenga la configuración correcta de deployment:
   ```toml
   [deployment]
   build = ["sh", "-c", "pnpm install && pnpm run build"]
   run = ["node", "dist/index.js"]
   deploymentTarget = "autoscale"
   ```

2. **NO uses** el botón "Run" para deployment - usa el botón **"Deploy"**

3. Si el error persiste, verifica que:
   - El script `start` en `package.json` use `node dist/index.js`
   - El script `build` compile correctamente el frontend y backend
   - Las variables de entorno estén configuradas en Secrets

### "portal.manus.im's server IP address could not be found"

Este error significa que estás usando una versión antigua con dependencias de Manus. Actualiza el código:

```bash
git fetch origin
git reset --hard origin/main
```

### "Authentication failed" errors

La autenticación está completamente deshabilitada. Si ves estos errores, verifica que tienes el código más reciente.

### Port conflicts

Si el puerto 5000 está en uso, la app intentará automáticamente los puertos 3001-3019. O establece la variable de entorno `PORT`.

### Missing environment variables

Revisa la salida de la consola para advertencias sobre variables faltantes. Añádelas en tu panel de Secrets/Environment.

### Build fails

Si el build falla:

1. Verifica que todas las dependencias estén instaladas: `pnpm install`
2. Revisa los logs de error para identificar el problema
3. Asegúrate de que `NODE_ENV=production` esté establecido
4. Verifica que los archivos TypeScript compilen sin errores: `pnpm check`

## Architecture

- **Frontend**: React 19 + Tailwind CSS 4 + Wouter (routing)
- **Backend**: Express 4 + tRPC 11 + Drizzle ORM
- **Database**: PostgreSQL (Neon)
- **Payments**: Stripe
- **Email**: Resend
- **Build**: Vite (frontend) + esbuild (backend)

## Development

```bash
# Instalar dependencias
pnpm install

# Ejecutar servidor de desarrollo
pnpm dev

# Ejecutar tests
pnpm test

# Build para producción
pnpm run build

# Iniciar en modo producción (después del build)
pnpm start

# Verificar tipos TypeScript
pnpm check
```

## Scripts de Package.json

- `dev`: Modo desarrollo con hot-reload (tsx watch)
- `build`: Compila frontend (Vite) y backend (esbuild)
- `start`: Inicia el servidor en modo producción
- `check`: Verifica tipos TypeScript sin compilar
- `format`: Formatea el código con Prettier
- `test`: Ejecuta los tests con Vitest
- `db:push`: Genera y ejecuta migraciones de base de datos

## Production Checklist

Antes de hacer deployment a producción:

- [ ] Todas las variables de entorno están configuradas
- [ ] El build se completa sin errores: `pnpm run build`
- [ ] Los tests pasan: `pnpm test`
- [ ] La verificación de tipos pasa: `pnpm check`
- [ ] Las conexiones a base de datos funcionan
- [ ] Las integraciones de Stripe y Resend están configuradas
- [ ] El puerto está configurado correctamente (default: 5000)
- [ ] `NODE_ENV=production` está establecido

## Support

Para problemas o preguntas, revisa el repositorio de GitHub: https://github.com/g3lasio/kay-chyrris
