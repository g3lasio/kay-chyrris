# 🔔 Sistema de Notificaciones Push - Propuesta Técnica

## Resumen Ejecutivo

Sistema de notificaciones push nativas en tiempo real para Chyrris KAI, sin depender de email. Incluye categorización por importancia, persistencia en base de datos, y UI moderna con centro de notificaciones.

---

## 🎯 Objetivos

1. **Notificaciones en tiempo real** - Push notifications dentro de la aplicación web
2. **Categorización inteligente** - 4 niveles de importancia (Info, Warning, Important, Critical)
3. **Persistencia** - Historial completo de notificaciones en base de datos
4. **Multi-aplicación** - Soporte para Owl Fenc, LeadPrime y futuras apps
5. **Sin email** - Notificaciones instantáneas sin saturar el correo

---

## 🏗️ Arquitectura Propuesta

### Opción 1: Server-Sent Events (SSE) ⭐ **RECOMENDADA**

**Ventajas:**
- ✅ Nativa del navegador, no requiere librerías externas
- ✅ Conexión persistente unidireccional (servidor → cliente)
- ✅ Automáticamente reconecta si se pierde la conexión
- ✅ Funciona con HTTP/HTTPS estándar
- ✅ Ligero y eficiente

**Desventajas:**
- ⚠️ Solo servidor → cliente (suficiente para notificaciones)
- ⚠️ Límite de 6 conexiones simultáneas por dominio (no es problema para 1 usuario)

**Implementación:**
```typescript
// Backend: Endpoint SSE
app.get('/api/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Enviar notificación
  res.write(`data: ${JSON.stringify(notification)}\n\n`);
});

// Frontend: Escuchar notificaciones
const eventSource = new EventSource('/api/notifications/stream');
eventSource.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  showNotification(notification);
};
```

---

### Opción 2: WebSockets

**Ventajas:**
- ✅ Comunicación bidireccional
- ✅ Más flexible para chat o interacciones complejas

**Desventajas:**
- ⚠️ Requiere librería adicional (socket.io)
- ⚠️ Más complejo de implementar
- ⚠️ Overkill para notificaciones unidireccionales

---

### Opción 3: Polling (No recomendado)

**Desventajas:**
- ❌ Ineficiente (requests constantes cada X segundos)
- ❌ Mayor carga en servidor
- ❌ No es tiempo real

---

## 📊 Esquema de Base de Datos

### Tabla: `in_app_notifications`

```sql
CREATE TABLE `in_app_notifications` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `application_id` int NOT NULL,
  `user_id` varchar(100), -- Null = notificación global
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `priority` enum('info', 'warning', 'important', 'critical') NOT NULL DEFAULT 'info',
  `category` varchar(50), -- 'payment', 'contract', 'user', 'system'
  `action_url` text, -- Link para "Ver más"
  `action_label` varchar(50), -- "Ver contrato", "Revisar pago"
  `icon` varchar(50), -- Emoji o nombre de icono
  `read` boolean NOT NULL DEFAULT false,
  `read_at` timestamp NULL,
  `archived` boolean NOT NULL DEFAULT false,
  `expires_at` timestamp NULL, -- Auto-archivar después de X días
  `metadata` json, -- Datos adicionales (IDs, referencias)
  `created_at` timestamp NOT NULL DEFAULT NOW(),
  
  INDEX idx_user_unread (user_id, read, created_at),
  INDEX idx_app_priority (application_id, priority, created_at),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
```

### Tabla: `notification_preferences`

```sql
CREATE TABLE `notification_preferences` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `user_id` varchar(100) NOT NULL UNIQUE,
  `application_id` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `min_priority` enum('info', 'warning', 'important', 'critical') DEFAULT 'info',
  `categories_enabled` json, -- ['payment', 'contract', 'user']
  `quiet_hours_start` time, -- 22:00
  `quiet_hours_end` time, -- 08:00
  `updated_at` timestamp NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
```

---

## 🎨 Niveles de Importancia

### 1. **Info** (Azul 🔵)
- Actualizaciones generales
- Nuevas funcionalidades
- Tips y sugerencias
- **Ejemplos:**
  - "Nuevo usuario registrado en Owl Fenc"
  - "Reporte mensual disponible"

### 2. **Warning** (Amarillo 🟡)
- Requiere atención pero no es urgente
- Recordatorios
- **Ejemplos:**
  - "Contrato vence en 7 días"
  - "Factura pendiente de revisión"

### 3. **Important** (Naranja 🟠)
- Requiere acción pronto
- Eventos significativos
- **Ejemplos:**
  - "Nuevo pago recibido: $5,000"
  - "Contrato firmado por cliente"
  - "Usuario canceló suscripción"

### 4. **Critical** (Rojo 🔴)
- Requiere atención inmediata
- Errores críticos
- Problemas de seguridad
- **Ejemplos:**
  - "Pago falló 3 veces consecutivas"
  - "Error en sistema de facturación"
  - "Actividad sospechosa detectada"

---

## 🎯 Categorías de Notificaciones

### Owl Fenc
- **payment** - Pagos, facturas, suscripciones
- **contract** - Contratos, estimados, propuestas
- **user** - Nuevos usuarios, cambios de plan
- **system** - Errores, mantenimiento, actualizaciones

### LeadPrime
- **lead** - Nuevos leads, actualizaciones de leads
- **contact** - Interacciones con contactos
- **pipeline** - Cambios en pipeline de ventas
- **system** - Errores, mantenimiento

---

## 💻 Componentes de UI

### 1. **Notification Bell (Header)**
```tsx
<NotificationBell>
  <Badge count={unreadCount} />
  <Dropdown>
    <NotificationList />
  </Dropdown>
</NotificationBell>
```

**Features:**
- Badge con número de no leídas
- Dropdown con últimas 5 notificaciones
- Botón "Ver todas"
- Indicador de prioridad (color del borde)

### 2. **Notification Center (Página completa)**
```
/notifications
```

**Features:**
- Lista completa de notificaciones
- Filtros: Todas / No leídas / Por prioridad / Por categoría
- Búsqueda
- Acciones: Marcar como leída, Archivar, Eliminar
- Paginación infinita

### 3. **Toast Notifications (Pop-ups)**

**Comportamiento por prioridad:**
- **Info**: No muestra toast, solo actualiza badge
- **Warning**: Toast 5 segundos, desaparece automáticamente
- **Important**: Toast 10 segundos, requiere cerrar manualmente
- **Critical**: Toast persistente + sonido, requiere acción

---

## 🔧 API Endpoints

### Backend (tRPC)

```typescript
notifications: router({
  // Obtener notificaciones del usuario
  getAll: publicProcedure
    .input(z.object({
      userId: z.string().optional(),
      applicationId: z.number(),
      priority: z.enum(['info', 'warning', 'important', 'critical']).optional(),
      unreadOnly: z.boolean().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => { /* ... */ }),

  // Marcar como leída
  markAsRead: publicProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input }) => { /* ... */ }),

  // Marcar todas como leídas
  markAllAsRead: publicProcedure
    .input(z.object({ userId: z.string(), applicationId: z.number() }))
    .mutation(async ({ input }) => { /* ... */ }),

  // Archivar notificación
  archive: publicProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input }) => { /* ... */ }),

  // Crear notificación (admin/sistema)
  create: publicProcedure
    .input(z.object({
      applicationId: z.number(),
      userId: z.string().optional(), // Null = broadcast
      title: z.string(),
      message: z.string(),
      priority: z.enum(['info', 'warning', 'important', 'critical']),
      category: z.string().optional(),
      actionUrl: z.string().optional(),
      actionLabel: z.string().optional(),
      icon: z.string().optional(),
    }))
    .mutation(async ({ input }) => { /* ... */ }),

  // Stream SSE
  stream: publicProcedure
    .input(z.object({ userId: z.string(), applicationId: z.number() }))
    .subscription(({ input }) => { /* SSE stream */ }),
});
```

---

## 📱 Casos de Uso

### Ejemplo 1: Nuevo pago en Owl Fenc

```typescript
await createNotification({
  applicationId: 1, // Owl Fenc
  userId: 'contractor_123',
  title: 'Nuevo pago recibido',
  message: 'Cliente ABC Corp pagó $5,000 por Proyecto XYZ',
  priority: 'important',
  category: 'payment',
  actionUrl: '/owlfenc/payments/12345',
  actionLabel: 'Ver pago',
  icon: '💰',
});
```

**Resultado:**
- ✅ Toast naranja aparece inmediatamente
- ✅ Badge +1 en notification bell
- ✅ Guardado en base de datos
- ✅ Usuario puede hacer click para ver detalles

### Ejemplo 2: Error crítico en sistema

```typescript
await createNotification({
  applicationId: 1,
  userId: null, // Broadcast a todos los admins
  title: '🚨 Error crítico en facturación',
  message: 'El sistema de Stripe no responde. Pagos bloqueados.',
  priority: 'critical',
  category: 'system',
  actionUrl: '/owlfenc/settings/integrations',
  actionLabel: 'Revisar configuración',
  icon: '⚠️',
});
```

**Resultado:**
- 🔴 Toast rojo persistente con sonido
- 🔴 Requiere acción del usuario
- 🔴 Visible para todos los admins

---

## 🚀 Plan de Implementación

### Fase 1: Base (1-2 días)
- [ ] Crear tablas en base de datos
- [ ] Implementar endpoints tRPC básicos
- [ ] Crear servicio de notificaciones backend

### Fase 2: SSE Stream (1 día)
- [ ] Implementar endpoint SSE
- [ ] Crear hook React para escuchar notificaciones
- [ ] Manejar reconexión automática

### Fase 3: UI Components (2 días)
- [ ] NotificationBell component con badge
- [ ] NotificationDropdown con lista
- [ ] Toast notifications con prioridades
- [ ] Notification Center (página completa)

### Fase 4: Integración (1 día)
- [ ] Conectar con eventos de Owl Fenc (pagos, contratos)
- [ ] Conectar con eventos de LeadPrime (leads, contactos)
- [ ] Testing end-to-end

### Fase 5: Preferencias (1 día)
- [ ] UI para configurar preferencias
- [ ] Filtros por categoría
- [ ] Quiet hours

---

## 🎨 Mockup Visual

```
┌─────────────────────────────────────────┐
│  Chyrris KAI          🔔 [3]  👤 User  │
├─────────────────────────────────────────┤
│                                         │
│  Notification Bell Dropdown:            │
│  ┌───────────────────────────────────┐ │
│  │ 🔴 Error crítico en facturación   │ │
│  │    Hace 2 minutos                 │ │
│  ├───────────────────────────────────┤ │
│  │ 🟠 Nuevo pago recibido: $5,000    │ │
│  │    Hace 10 minutos                │ │
│  ├───────────────────────────────────┤ │
│  │ 🟡 Contrato vence en 7 días       │ │
│  │    Hace 1 hora                    │ │
│  ├───────────────────────────────────┤ │
│  │        Ver todas (23)             │ │
│  └───────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

---

## 💰 Costos

**Opción SSE (Recomendada):**
- ✅ $0 - Nativo del navegador
- ✅ No requiere servicios externos
- ✅ Funciona con infraestructura actual

**Alternativa (Firebase Cloud Messaging):**
- 💵 Gratis hasta 10M mensajes/mes
- ⚠️ Requiere configuración adicional
- ⚠️ Depende de servicio externo

---

## 🎯 Recomendación Final

**Implementar SSE (Server-Sent Events)** por:

1. ✅ Cero costo adicional
2. ✅ Nativo y ligero
3. ✅ Perfecto para notificaciones unidireccionales
4. ✅ Fácil de implementar y mantener
5. ✅ No depende de servicios externos

**Timeline total: 5-7 días de desarrollo**

---

## 📝 Próximos Pasos

1. **Aprobar propuesta** - Confirmar arquitectura SSE
2. **Definir eventos prioritarios** - ¿Qué notificaciones son más importantes?
3. **Diseño UI** - Revisar mockups y ajustar colores/estilos
4. **Implementación** - Seguir plan de 5 fases

¿Aprobamos esta propuesta para comenzar la implementación?
