# 📊 Guía de Tracking de Planes de Usuario

## 🎯 Planes Disponibles

El sistema ahora trackea **4 tipos de planes** para tus usuarios de Owl Fenc:

| Plan | Código | Precio | Duración | Color en UI |
|------|--------|--------|----------|-------------|
| **Free Trial** | `trial` | $0.00 | 14 días | Gris (slate) |
| **Primo Chambeador** | `free` | $0.00 | Permanente | Azul (blue) |
| **Mero Patrón** | `patron` | $49.99 | Mensual | Púrpura (purple) |
| **Master Contractor** | `master` | $99.99 | Mensual | Ámbar (amber) |

---

## 📈 Vista de Estadísticas

### **Página de Users (`/owlfenc/users`)**

La página muestra **5 tarjetas de estadísticas**:

```
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│ Total Users │ Free Trial  │ Primo       │ Mero Patrón │ Master      │
│             │             │ Chambeador  │             │ Contractor  │
│    [##]     │    [##]     │    [##]     │    [##]     │    [##]     │
│             │  14 days    │  Free Plan  │ $49.99/mo   │ $99.99/mo   │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

### **Información Mostrada:**
- **Total Users**: Número total de usuarios registrados
- **Free Trial**: Usuarios en prueba gratuita de 14 días
- **Primo Chambeador**: Usuarios en plan gratuito permanente
- **Mero Patrón**: Usuarios pagando $49.99/mes
- **Master Contractor**: Usuarios pagando $99.99/mes

---

## 🔍 Filtrado por Plan

### **Dropdown de Filtros:**

Puedes filtrar usuarios por plan usando el dropdown:

```
┌─────────────────────────────────┐
│ All Plans                    ▼ │
├─────────────────────────────────┤
│ All Plans                       │
│ Free Trial (14 days)            │
│ Primo Chambeador (Free)         │
│ Mero Patrón ($49.99)            │
│ Master Contractor ($99.99)      │
└─────────────────────────────────┘
```

### **Casos de Uso:**

1. **Ver solo usuarios en trial**:
   - Selecciona "Free Trial (14 days)"
   - Útil para campañas de conversión antes de que expire el trial

2. **Ver usuarios free**:
   - Selecciona "Primo Chambeador (Free)"
   - Útil para campañas de upgrade a planes pagos

3. **Ver usuarios pagando**:
   - Selecciona "Mero Patrón" o "Master Contractor"
   - Útil para análisis de retención y upsell

---

## 📊 Estrategias de Campaña por Plan

### **1. Free Trial (14 días)**

**Objetivo**: Convertir a plan pago antes de que expire

**Acciones Recomendadas:**
- Enviar emails de onboarding durante los primeros 3 días
- Recordatorio a los 7 días (mitad del trial)
- Oferta especial a los 12 días (últimos 2 días)
- Email de "última oportunidad" el día 14

**Métricas a Trackear:**
- Tasa de conversión trial → pago
- Días promedio de uso durante trial
- Features más usadas durante trial

---

### **2. Primo Chambeador (Free)**

**Objetivo**: Upgrade a Mero Patrón o Master Contractor

**Acciones Recomendadas:**
- Mostrar beneficios de planes pagos
- Ofrecer descuento por primer mes
- Destacar features premium que no tienen
- Casos de éxito de usuarios pagos

**Métricas a Trackear:**
- Tiempo promedio en plan free
- Tasa de conversión free → pago
- Features que intentan usar pero están bloqueadas

---

### **3. Mero Patrón ($49.99)**

**Objetivo**: Retención y posible upsell a Master Contractor

**Acciones Recomendadas:**
- Emails de valor agregado (tips, mejores prácticas)
- Encuestas de satisfacción
- Ofrecer upgrade a Master con beneficios claros
- Programa de referidos

**Métricas a Trackear:**
- Tasa de retención mensual
- Uso de features del plan
- Tasa de upgrade a Master
- Lifetime Value (LTV)

---

### **4. Master Contractor ($99.99)**

**Objetivo**: Máxima retención y advocacy

**Acciones Recomendadas:**
- Soporte prioritario
- Acceso anticipado a nuevas features
- Programa VIP con beneficios exclusivos
- Pedir testimonios y casos de éxito

**Métricas a Trackear:**
- Tasa de retención (debe ser >95%)
- Net Promoter Score (NPS)
- Uso de features avanzadas
- Lifetime Value (LTV)

---

## 📋 Tabla de Usuarios con Planes

### **Columnas Mostradas:**

| Columna | Descripción |
|---------|-------------|
| **Name** | Nombre del usuario |
| **Email** | Email de contacto |
| **Plan** | Badge con color del plan actual |
| **Status** | Active / Disabled |
| **Login Method** | Email / Phone |
| **Joined** | Fecha de registro |
| **Last Sign In** | Última vez que inició sesión |
| **Actions** | Botón "View" para ver detalles |

### **Badges de Plan:**

Los badges tienen colores distintivos:

- 🔘 **Free Trial**: Gris (`bg-slate-500/20 text-slate-400`)
- 🔵 **Primo Chambeador**: Azul (`bg-blue-500/20 text-blue-400`)
- 🟣 **Mero Patrón**: Púrpura (`bg-purple-500/20 text-purple-400`)
- 🟡 **Master Contractor**: Ámbar (`bg-amber-500/20 text-amber-400`)

---

## 🔄 Flujo de Datos

### **Fuentes de Información:**

```
Firebase Authentication
         ↓
    (usuarios básicos)
         ↓
PostgreSQL Database
         ↓
  subscription_plans ← Definición de planes
         +
  user_subscriptions ← Suscripciones activas
         ↓
Backend (owlfenc-firebase.ts)
         ↓
getOwlFencUsersWithPlans()
         ↓
Frontend (Users.tsx)
         ↓
Visualización con estadísticas
```

### **Lógica de Asignación:**

1. **Usuario en PostgreSQL con suscripción activa**:
   → Muestra el plan correspondiente

2. **Usuario en PostgreSQL sin suscripción activa**:
   → Default: "Primo Chambeador" (Free)

3. **Usuario solo en Firebase (no en PostgreSQL)**:
   → Default: "Primo Chambeador" (Free)

---

## 📊 Reportes y Análisis

### **Métricas Clave a Monitorear:**

#### **1. Distribución de Planes**
```
Total: 100 usuarios
├─ Free Trial: 15 (15%)
├─ Primo Chambeador: 50 (50%)
├─ Mero Patrón: 25 (25%)
└─ Master Contractor: 10 (10%)
```

#### **2. Tasa de Conversión**
- **Trial → Pago**: % de trials que se convierten
- **Free → Pago**: % de usuarios free que upgraden
- **Patrón → Master**: % de upgrades al plan más alto

#### **3. Revenue Mensual Recurrente (MRR)**
```
MRR = (Mero Patrón × $49.99) + (Master Contractor × $99.99)
Ejemplo: (25 × $49.99) + (10 × $99.99) = $2,249.65
```

#### **4. Valor de Vida del Cliente (LTV)**
```
LTV = Revenue Mensual × Meses Promedio de Retención
```

---

## 🎯 Segmentación para Campañas

### **Segmento 1: Nuevos Trials (0-7 días)**
- **Objetivo**: Activación y engagement
- **Mensaje**: Onboarding, tutoriales, soporte
- **Canal**: Email, notificaciones in-app

### **Segmento 2: Trials Próximos a Expirar (8-14 días)**
- **Objetivo**: Conversión a pago
- **Mensaje**: Beneficios, oferta especial, urgencia
- **Canal**: Email, SMS (si disponible)

### **Segmento 3: Free de Largo Plazo (>30 días)**
- **Objetivo**: Upgrade a pago
- **Mensaje**: Casos de éxito, ROI, features premium
- **Canal**: Email, remarketing

### **Segmento 4: Pagos Activos**
- **Objetivo**: Retención y satisfacción
- **Mensaje**: Valor agregado, tips, nuevas features
- **Canal**: Newsletter, webinars

### **Segmento 5: Riesgo de Churn**
- **Objetivo**: Prevenir cancelación
- **Mensaje**: Encuesta, oferta especial, soporte
- **Canal**: Email personalizado, llamada (para Master)

---

## 🛠️ Cómo Usar el Sistema

### **1. Ver Estadísticas Generales**
1. Ve a `/owlfenc/users`
2. Observa las 5 tarjetas en la parte superior
3. Identifica qué plan tiene más usuarios

### **2. Filtrar por Plan Específico**
1. Usa el dropdown "All Plans"
2. Selecciona el plan que quieres analizar
3. La tabla se actualiza mostrando solo esos usuarios

### **3. Buscar Usuario Específico**
1. Usa el campo de búsqueda
2. Escribe nombre o email
3. Combina con filtro de plan si es necesario

### **4. Ver Detalles de Usuario**
1. Haz clic en "View" en la fila del usuario
2. Se abre un modal con información completa
3. Incluye detalles de suscripción y uso

### **5. Exportar Datos (Próximamente)**
- Botón de exportación a CSV
- Filtros aplicados se mantienen en la exportación
- Útil para análisis en Excel/Google Sheets

---

## 📝 Notas Importantes

### **Usuarios Sin Plan en PostgreSQL:**
- Se muestran como "Primo Chambeador" por defecto
- Esto es normal para usuarios nuevos
- El plan se actualiza cuando hacen una suscripción

### **Sincronización:**
- Los datos se actualizan en tiempo real
- Firebase Auth es la fuente de verdad para usuarios
- PostgreSQL es la fuente de verdad para suscripciones

### **Performance:**
- El sistema puede manejar hasta 1000 usuarios sin problemas
- Para más usuarios, considera implementar paginación
- Los filtros se aplican en el cliente (rápido)

---

## 🚀 Próximas Mejoras

### **Corto Plazo:**
- [ ] Exportación a CSV con filtros
- [ ] Gráfico de distribución de planes (pie chart)
- [ ] Histórico de cambios de plan por usuario

### **Mediano Plazo:**
- [ ] Dashboard de métricas (MRR, churn, conversión)
- [ ] Alertas automáticas (trial expirando, churn risk)
- [ ] Segmentación avanzada para campañas

### **Largo Plazo:**
- [ ] Integración con herramientas de email marketing
- [ ] Predicción de churn con ML
- [ ] Análisis de cohortes

---

## 📞 Soporte

Si tienes preguntas sobre el sistema de tracking de planes:

1. Revisa esta documentación
2. Verifica que los datos en PostgreSQL estén correctos
3. Confirma que la tabla `subscription_plans` tenga los 4 planes
4. Asegúrate de que `user_subscriptions` esté actualizada

---

**Última actualización**: 29 de Enero, 2026  
**Versión del sistema**: 2.0 (con 4 planes)
