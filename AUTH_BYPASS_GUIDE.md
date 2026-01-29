# 🔓 Authentication Bypass Guide

## ⚠️ IMPORTANTE: Solo para Desarrollo

Este bypass de autenticación está diseñado para facilitar el desarrollo y testing. **NUNCA debe usarse en producción.**

---

## 🎯 ¿Qué Hace el Bypass?

El bypass de autenticación desactiva temporalmente el sistema de login, permitiendo:

- ✅ Acceso directo a todas las páginas sin iniciar sesión
- ✅ Todas las rutas protegidas son accesibles
- ✅ El backend acepta peticiones sin validar sesión
- ✅ Se crea un usuario mock con permisos de super_admin

---

## 🚀 Cómo Activar el Bypass

### **Opción 1: Variables de Entorno (Recomendado)**

#### En Replit:
1. Ve a **Secrets** (ícono de candado en el panel izquierdo)
2. Agrega estas variables:
   ```
   DISABLE_AUTH=true
   VITE_DISABLE_AUTH=true
   ```
3. Reinicia el servidor

#### En Local:
1. Crea o edita el archivo `.env` en la raíz del proyecto:
   ```bash
   # Frontend bypass
   VITE_DISABLE_AUTH=true
   
   # Backend bypass
   DISABLE_AUTH=true
   ```
2. Reinicia el servidor con `pnpm run dev`

---

## 🔒 Cómo Desactivar el Bypass (Reactivar Auth)

### **Método 1: Cambiar Variables**
Cambia los valores a `false`:
```
DISABLE_AUTH=false
VITE_DISABLE_AUTH=false
```

### **Método 2: Eliminar Variables**
Simplemente elimina las variables `DISABLE_AUTH` y `VITE_DISABLE_AUTH` de tus Secrets/env

### **Método 3: Comentar en Código**
Si prefieres hacerlo en el código:

**Frontend** (`client/src/components/ProtectedRoute.tsx`):
```typescript
// Cambiar esta línea:
const AUTH_BYPASS_ENABLED = import.meta.env.VITE_DISABLE_AUTH === 'true';

// Por:
const AUTH_BYPASS_ENABLED = false; // import.meta.env.VITE_DISABLE_AUTH === 'true';
```

**Backend** (`server/_core/trpc.ts`):
```typescript
// Cambiar esta línea:
const AUTH_BYPASS_ENABLED = process.env.DISABLE_AUTH === 'true';

// Por:
const AUTH_BYPASS_ENABLED = false; // process.env.DISABLE_AUTH === 'true';
```

---

## 📋 Archivos Modificados

### **1. Frontend**
**Archivo**: `client/src/components/ProtectedRoute.tsx`

**Cambio**: 
- Agregado check de variable `VITE_DISABLE_AUTH`
- Si está activa, renderiza children sin validar usuario
- Muestra warning en consola del navegador

### **2. Backend**
**Archivo**: `server/_core/trpc.ts`

**Cambio**:
- Agregado check de variable `DISABLE_AUTH`
- Si está activa, crea un usuario mock con permisos de super_admin
- Muestra warning en consola del servidor

### **3. Configuración**
**Archivos creados**:
- `.env` - Variables de entorno (no se sube a git)
- `.env.example` - Plantilla de ejemplo

---

## 🔍 Cómo Verificar que el Bypass Está Activo

### **En el Navegador:**
1. Abre la consola de desarrollador (F12)
2. Busca este mensaje:
   ```
   ⚠️ Authentication bypass is ENABLED. This should only be used in development!
   ```

### **En el Servidor:**
1. Revisa los logs del servidor
2. Busca estos mensajes:
   ```
   🚨 ========================================
   🚨 AUTH BYPASS IS ENABLED ON SERVER!
   🚨 This should ONLY be used in development!
   🚨 ========================================
   ```

### **Prueba Práctica:**
1. Abre el navegador en modo incógnito
2. Ve directamente a: `http://localhost:5000/owlfenc/users`
3. Si ves la página de usuarios sin ser redirigido a login → ✅ Bypass activo
4. Si te redirige a login → ❌ Bypass inactivo

---

## 👤 Usuario Mock Creado

Cuando el bypass está activo, el backend usa este usuario ficticio:

```typescript
{
  id: 1,
  email: 'dev@bypass.local',
  name: 'Dev User (Bypass Mode)',
  role: 'super_admin',
  isActive: true,
  lastLoginAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}
```

Este usuario tiene permisos de **super_admin**, por lo que puede acceder a todas las funcionalidades.

---

## 🛡️ Seguridad

### **¿Es Seguro?**
- ✅ **En desarrollo local**: Sí, es seguro
- ✅ **En Replit privado**: Sí, mientras no compartas el link
- ❌ **En producción**: NO, NUNCA usar en producción
- ❌ **En servidor público**: NO, cualquiera tendría acceso total

### **Protecciones Incluidas:**
1. **Variables de entorno**: Fácil de activar/desactivar
2. **Warnings visibles**: Alertas en consola para recordar que está activo
3. **No se sube a git**: `.env` está en `.gitignore`
4. **Documentación clara**: Este archivo explica los riesgos

---

## 🔄 Flujo de Autenticación

### **Con Bypass Desactivado (Normal):**
```
Usuario → Intenta acceder a /owlfenc/users
    ↓
ProtectedRoute verifica sesión
    ↓
¿Hay usuario autenticado?
    ├─ Sí → Muestra página
    └─ No → Redirige a /login
```

### **Con Bypass Activado:**
```
Usuario → Intenta acceder a /owlfenc/users
    ↓
ProtectedRoute detecta VITE_DISABLE_AUTH=true
    ↓
Muestra página directamente (sin verificar sesión)
```

---

## 🐛 Troubleshooting

### **Problema: El bypass no funciona**

**Solución 1**: Verifica las variables
```bash
# En el servidor, verifica:
echo $DISABLE_AUTH
echo $VITE_DISABLE_AUTH

# Deben mostrar: true
```

**Solución 2**: Reinicia completamente
```bash
# Detén el servidor (Ctrl+C)
# Reinicia con:
pnpm run dev
```

**Solución 3**: Limpia caché
```bash
# Borra node_modules y reinstala
rm -rf node_modules
pnpm install
pnpm run dev
```

### **Problema: Sigo viendo la página de login**

**Causa**: El frontend no detecta la variable

**Solución**:
1. Verifica que la variable se llame exactamente `VITE_DISABLE_AUTH`
2. En Vite, las variables deben empezar con `VITE_`
3. Reinicia el servidor después de agregar la variable

### **Problema: Error "UNAUTHORIZED" en peticiones**

**Causa**: El backend no detecta la variable

**Solución**:
1. Verifica que la variable se llame exactamente `DISABLE_AUTH`
2. Reinicia el servidor
3. Verifica los logs para ver si aparece el warning de bypass

---

## 📝 Checklist de Producción

Antes de desplegar a producción, verifica:

- [ ] `DISABLE_AUTH` está en `false` o eliminada
- [ ] `VITE_DISABLE_AUTH` está en `false` o eliminada
- [ ] No hay warnings de bypass en los logs
- [ ] El login funciona correctamente
- [ ] Las rutas protegidas redirigen a login sin sesión
- [ ] Los usuarios deben autenticarse para acceder

---

## 🔧 Mantenimiento Futuro

### **Para Reactivar la Autenticación Permanentemente:**

Si ya no necesitas el bypass y quieres limpiarlo del código:

1. **Elimina el código de bypass**:
   - En `ProtectedRoute.tsx`: Elimina las líneas 5-15
   - En `trpc.ts`: Elimina las líneas 6-47

2. **Elimina archivos de configuración**:
   ```bash
   rm .env
   # Mantén .env.example para referencia
   ```

3. **Actualiza documentación**:
   - Elimina o archiva este archivo `AUTH_BYPASS_GUIDE.md`

---

## 💡 Tips de Uso

### **Durante Desarrollo:**
- Mantén el bypass activo en tu entorno local
- Facilita testing rápido sin login constante
- Útil para demos y presentaciones

### **Para Testing de Auth:**
- Desactiva el bypass temporalmente
- Prueba el flujo de login completo
- Verifica que las protecciones funcionen

### **Antes de Commits:**
- Verifica que `.env` no esté en el commit
- `.env.example` sí debe estar en git
- Documenta cambios en este archivo si modificas el bypass

---

## 📞 Soporte

Si tienes problemas con el bypass o la autenticación:

1. Revisa este documento completo
2. Verifica los logs del servidor y navegador
3. Confirma que las variables estén correctamente configuradas
4. Prueba reiniciando el servidor

---

## ⚡ Resumen Rápido

**Activar bypass:**
```bash
# En Replit Secrets o .env local:
DISABLE_AUTH=true
VITE_DISABLE_AUTH=true
```

**Desactivar bypass:**
```bash
# Elimina las variables o cámbialas a:
DISABLE_AUTH=false
VITE_DISABLE_AUTH=false
```

**Verificar estado:**
- Consola del navegador: Busca warning de bypass
- Logs del servidor: Busca mensaje de bypass activo
- Prueba: Accede a ruta protegida sin login

---

**Última actualización**: 29 de Enero, 2026  
**Versión del bypass**: 1.0
