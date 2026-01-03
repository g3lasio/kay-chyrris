# Owl Fenc Firestore Collections Audit

## 📊 Collections Identificadas

### Core Business Collections
1. **clients** - Clientes de los usuarios
2. **contracts** - Contratos generados
3. **contractHistory** - Historial de cambios en contratos
4. **dualSignatureContracts** - Contratos con firma dual
5. **estimates** - Estimados (básicos y AI)
6. **shared_estimates** - Estimados compartidos públicamente
7. **projects** - Proyectos de construcción
8. **companyProfiles** - Perfiles de compañías
9. **companyInfo** - Información de compañías
10. **userProfiles** - Perfiles de usuarios

### Payment & Subscription
11. **stripe_customers** - Clientes de Stripe
12. **entitlements** - Permisos y límites de suscripción
13. **usage** - Uso de features por usuario

### System & Admin
14. **admin_analytics** - Analytics para admin
15. **admin_notifications** - Notificaciones de admin
16. **audit_logs** - Logs de auditoría
17. **security_audit_logs** - Logs de seguridad
18. **audit_exports** - Exportaciones de auditoría
19. **data_exports** - Exportaciones de datos
20. **export_summaries** - Resúmenes de exportaciones
21. **kpi_reports** - Reportes de KPIs
22. **webhook_logs** - Logs de webhooks

### User Management
23. **users** - Usuarios del sistema
24. **user_security** - Configuración de seguridad por usuario
25. **user_sessions** - Sesiones activas de usuarios
26. **token_revocations** - Tokens revocados

### Support & Notifications
27. **notifications** - Notificaciones a usuarios
28. **support_tickets** - Tickets de soporte
29. **support_ticket_responses** - Respuestas a tickets

### Rate Limiting & Abuse
30. **rate_limits** - Límites de tasa por usuario
31. **abuse_logs** - Logs de abuso detectado

### Jobs & Processing
32. **completionJobs** - Jobs de procesamiento asíncrono

### Settings
33. **settings** - Configuraciones globales
34. **system_config** - Configuración del sistema

## ❌ Collections NO Encontradas (pero mencionadas por el usuario)

1. **invoices** - NO EXISTE en el código actual
2. **payments** / **paymentHistory** - Mencionado pero no encontrado en grep
3. **permits** / **permitHistory** - Mencionado pero no encontrado
4. **properties** - Mencionado pero no encontrado

## 🔍 Análisis de userId Field

Necesitamos verificar si cada colección tiene el campo `userId` para poder hacer el tracking por usuario:

### ✅ Confirmadas con userId:
- clients
- contracts
- estimates
- projects

### ❓ Por Verificar:
- contractHistory
- dualSignatureContracts
- shared_estimates
- companyProfiles
- userProfiles
- usage

## 📝 Recomendaciones para Usage System

### 1. Collections a Trackear por Usuario:
```typescript
{
  clients: count by userId,
  contracts: count by userId,
  contractHistory: count by userId (historial de cambios),
  estimates: count by userId,
  projects: count by userId,
  shared_estimates: count by userId,
  dualSignatureContracts: count by userId
}
```

### 2. Métricas Globales del Sistema:
```typescript
{
  totalUsers: count of users collection,
  totalClients: count of clients collection,
  totalContracts: count of contracts collection,
  totalEstimates: count of estimates collection,
  totalProjects: count of projects collection,
  activeUsers: users with activity in last 30 days
}
```

### 3. Tracking de Emails y PDFs:
**PROBLEMA:** No existe una colección dedicada para trackear:
- Emails enviados (Resend API)
- PDFs generados

**SOLUCIÓN:** Crear nuevas colecciones:
```typescript
// Nueva colección: email_logs
{
  userId: string,
  recipientEmail: string,
  emailType: 'estimate' | 'contract' | 'invoice' | 'notification',
  sentAt: Timestamp,
  status: 'sent' | 'failed',
  resendId: string
}

// Nueva colección: pdf_logs
{
  userId: string,
  documentType: 'estimate' | 'contract' | 'invoice' | 'permit',
  documentId: string,
  generatedAt: Timestamp,
  fileSize: number,
  status: 'success' | 'failed'
}
```

### 4. Invoices, Payments, Permits, Properties:
**PROBLEMA:** Estas colecciones NO EXISTEN en el código actual.

**OPCIONES:**
a) El usuario se refiere a features futuras no implementadas
b) Están en otra base de datos (PostgreSQL?)
c) Están nombradas diferente en el código

**ACCIÓN:** Preguntar al usuario sobre estas colecciones.
