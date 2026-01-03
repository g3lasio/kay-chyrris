# 🎯 Plan Completo de Control de Usage - Owl Fenc & Chyrris KAI

## Objetivo
Tener **control total** de todas las operaciones por usuario y a nivel sistema para:
- Monitorear límites de servicios externos (Resend 500 emails/día, PDF generators)
- Identificar usuarios con alto uso
- Detectar problemas antes de llegar a límites
- Tener datos precisos para billing y analytics

---

## 📊 PARTE 1: Estandarizar Owl Fenc App

### Problema Actual
Las colecciones usan nombres inconsistentes para el campo de usuario:
- `invoices` → usa `userId`
- `estimates` → usa `firebaseUserId`
- `clients` → usa `userId`
- `contracts` → usa `userId`

### Solución: Estandarizar a `userId`

**Acción:** Crear script de migración para agregar campo `userId` a todas las colecciones que usan `firebaseUserId`.

```javascript
// Migration script: standardize-user-id.js
// Para cada documento en 'estimates' que tenga 'firebaseUserId':
//   - Agregar campo 'userId' con el mismo valor
//   - Mantener 'firebaseUserId' por compatibilidad (deprecated)
```

---

## 📧 PARTE 2: Tracking de Emails (Resend)

### Nueva Colección: `email_logs`

**Estructura:**
```typescript
{
  id: string,                    // Auto-generado por Firestore
  userId: string,                // Usuario que envió el email
  recipientEmail: string,        // Destinatario
  emailType: 'invoice' | 'estimate' | 'contract' | 'payment_link' | 'dual_signature' | 'notification',
  documentId: string,            // ID del documento relacionado (invoice, estimate, etc)
  resendId: string,              // ID de Resend para tracking
  status: 'sent' | 'failed',
  errorMessage: string | null,   // Si falló, guardar el error
  sentAt: Timestamp,             // Fecha/hora de envío
  metadata: {                    // Info adicional
    subject: string,
    attachments: number
  }
}
```

### Implementación en Owl Fenc

**Archivo:** `server/services/emailTrackingService.ts`

```typescript
import { getFirestore, collection, addDoc, Timestamp } from 'firebase-admin/firestore';

export async function logEmailSent(data: {
  userId: string;
  recipientEmail: string;
  emailType: string;
  documentId: string;
  resendId: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
  metadata?: any;
}) {
  const db = getFirestore();
  
  await addDoc(collection(db, 'email_logs'), {
    ...data,
    sentAt: Timestamp.now()
  });
  
  console.log(`📧 [EMAIL-TRACKING] Logged email: ${data.emailType} to ${data.recipientEmail}`);
}
```

**Integración:** Modificar todos los servicios que envían emails:
- `server/services/invoiceEmailService.ts`
- `server/services/emailService.ts`
- Cualquier lugar que llame a Resend API

**Ejemplo de uso:**
```typescript
// Después de enviar email con Resend
const resendResponse = await resend.emails.send({...});

// Inmediatamente después, loguear
await logEmailSent({
  userId: currentUser.uid,
  recipientEmail: invoice.clientEmail,
  emailType: 'invoice',
  documentId: invoice.id,
  resendId: resendResponse.id,
  status: 'sent',
  metadata: {
    subject: `Invoice ${invoice.invoiceNumber}`,
    attachments: 1
  }
});
```

---

## 📄 PARTE 3: Tracking de PDFs Generados

### Nueva Colección: `pdf_logs`

**Estructura:**
```typescript
{
  id: string,                    // Auto-generado por Firestore
  userId: string,                // Usuario que generó el PDF
  documentType: 'invoice' | 'estimate' | 'contract' | 'permit_report' | 'property_report',
  documentId: string,            // ID del documento original
  documentNumber: string,        // Número de factura/contrato/etc
  clientName: string,            // Nombre del cliente
  fileSize: number,              // Tamaño en bytes
  pdfService: 'puppeteer' | 'pdfmonkey' | 'jspdf' | 'other',
  generatedAt: Timestamp,        // Fecha/hora de generación
  storageUrl: string | null,     // URL si se guardó en Firebase Storage
  status: 'success' | 'failed',
  errorMessage: string | null,
  metadata: {
    pageCount: number,
    totalAmount: number          // Para invoices/estimates
  }
}
```

### Implementación en Owl Fenc

**Archivo:** `server/services/pdfTrackingService.ts`

```typescript
import { getFirestore, collection, addDoc, Timestamp } from 'firebase-admin/firestore';

export async function logPdfGenerated(data: {
  userId: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  clientName: string;
  fileSize: number;
  pdfService: string;
  storageUrl?: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  metadata?: any;
}) {
  const db = getFirestore();
  
  await addDoc(collection(db, 'pdf_logs'), {
    ...data,
    generatedAt: Timestamp.now()
  });
  
  console.log(`📄 [PDF-TRACKING] Logged PDF: ${data.documentType} - ${data.documentNumber}`);
}
```

**Integración:** Modificar todos los servicios que generan PDFs:
- `server/invoice-pdf-service.ts`
- `server/services/unifiedPdfService.ts`
- `server/services/pdf/permitReportGenerator.ts`
- Cualquier servicio que genere PDFs

**Ejemplo de uso:**
```typescript
// Después de generar PDF
const pdfBuffer = await generateInvoicePdf(invoiceData);

// Inmediatamente después, loguear
await logPdfGenerated({
  userId: currentUser.uid,
  documentType: 'invoice',
  documentId: invoice.id,
  documentNumber: invoice.invoiceNumber,
  clientName: invoice.clientName,
  fileSize: pdfBuffer.length,
  pdfService: 'puppeteer',
  status: 'success',
  metadata: {
    pageCount: 1,
    totalAmount: invoice.totalAmount
  }
});
```

---

## 🔄 PARTE 4: Actualizar Chyrris KAI Backend

### Modificar: `server/services/owlfenc-firebase.ts`

**Nueva función: `getUserUsageBreakdown()` - VERSIÓN COMPLETA**

```typescript
export async function getUserUsageBreakdown() {
  try {
    const db = getFirestore();
    const auth = getAuth();
    
    // Get all users
    const listUsersResult = await auth.listUsers(1000);
    
    // For each user, count ALL their documents
    const userUsagePromises = listUsersResult.users.map(async (userRecord) => {
      const userId = userRecord.uid;
      
      // Count documents in parallel
      const [
        clientsSnapshot,
        contractsSnapshot,
        invoicesSnapshot,
        estimatesSnapshot,
        projectsSnapshot,
        paymentsSnapshot,
        emailsSnapshot,
        pdfsSnapshot
      ] = await Promise.all([
        // Clients
        db.collection('clients').where('userId', '==', userId).count().get(),
        
        // Contracts
        db.collection('contracts').where('userId', '==', userId).count().get(),
        
        // Invoices
        db.collection('invoices').where('userId', '==', userId).count().get(),
        
        // Estimates (usa firebaseUserId temporalmente, luego cambiar a userId)
        db.collection('estimates').where('firebaseUserId', '==', userId).count().get(),
        
        // Projects
        db.collection('projects').where('userId', '==', userId).count().get(),
        
        // Payment History
        db.collection('paymentHistory').where('userId', '==', userId).count().get(),
        
        // Email Logs (nueva colección)
        db.collection('email_logs').where('userId', '==', userId).count().get(),
        
        // PDF Logs (nueva colección)
        db.collection('pdf_logs').where('userId', '==', userId).count().get()
      ]);
      
      return {
        uid: userRecord.uid,
        email: userRecord.email || 'N/A',
        displayName: userRecord.displayName || 'N/A',
        clientsCount: clientsSnapshot.data().count,
        contractsCount: contractsSnapshot.data().count,
        invoicesCount: invoicesSnapshot.data().count,
        estimatesCount: estimatesSnapshot.data().count,
        projectsCount: projectsSnapshot.data().count,
        paymentsCount: paymentsSnapshot.data().count,
        emailsSentCount: emailsSnapshot.data().count,
        pdfsGeneratedCount: pdfsSnapshot.data().count
      };
    });
    
    const userUsage = await Promise.all(userUsagePromises);
    
    // Filter out users with zero activity
    return userUsage.filter(user => 
      user.clientsCount > 0 || 
      user.contractsCount > 0 || 
      user.invoicesCount > 0 || 
      user.estimatesCount > 0 ||
      user.projectsCount > 0 ||
      user.paymentsCount > 0 ||
      user.emailsSentCount > 0 ||
      user.pdfsGeneratedCount > 0
    );
  } catch (error) {
    console.error('[Firebase] Error fetching user usage breakdown:', error);
    throw error;
  }
}
```

**Nueva función: `getSystemUsageMetrics()` - VERSIÓN COMPLETA**

```typescript
export async function getSystemUsageMetrics() {
  try {
    const db = getFirestore();
    
    // Get total counts for ALL collections
    const [
      clientsSnapshot,
      contractsSnapshot,
      invoicesSnapshot,
      estimatesSnapshot,
      projectsSnapshot,
      paymentsSnapshot,
      emailsTodaySnapshot,
      emailsMonthSnapshot,
      pdfsTodaySnapshot,
      pdfsMonthSnapshot
    ] = await Promise.all([
      db.collection('clients').count().get(),
      db.collection('contracts').count().get(),
      db.collection('invoices').count().get(),
      db.collection('estimates').count().get(),
      db.collection('projects').count().get(),
      db.collection('paymentHistory').count().get(),
      
      // Emails sent TODAY
      db.collection('email_logs')
        .where('sentAt', '>=', getTodayStart())
        .count().get(),
      
      // Emails sent THIS MONTH
      db.collection('email_logs')
        .where('sentAt', '>=', getMonthStart())
        .count().get(),
      
      // PDFs generated TODAY
      db.collection('pdf_logs')
        .where('generatedAt', '>=', getTodayStart())
        .count().get(),
      
      // PDFs generated THIS MONTH
      db.collection('pdf_logs')
        .where('generatedAt', '>=', getMonthStart())
        .count().get()
    ]);
    
    return {
      // Core metrics
      totalClients: clientsSnapshot.data().count,
      totalContracts: contractsSnapshot.data().count,
      totalInvoices: invoicesSnapshot.data().count,
      totalEstimates: estimatesSnapshot.data().count,
      totalProjects: projectsSnapshot.data().count,
      totalPayments: paymentsSnapshot.data().count,
      
      // Email tracking (Resend limit: 500/day)
      emailsSentToday: emailsTodaySnapshot.data().count,
      emailsSentMonth: emailsMonthSnapshot.data().count,
      emailDailyLimit: 500,
      emailUsagePercentage: (emailsTodaySnapshot.data().count / 500) * 100,
      
      // PDF tracking
      pdfsGeneratedToday: pdfsTodaySnapshot.data().count,
      pdfsGeneratedMonth: pdfsMonthSnapshot.data().count
    };
  } catch (error) {
    console.error('[Firebase] Error fetching system usage metrics:', error);
    throw error;
  }
}

// Helper functions
function getTodayStart(): Timestamp {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(today);
}

function getMonthStart(): Timestamp {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return Timestamp.fromDate(monthStart);
}
```

---

## 🎨 PARTE 5: Actualizar Chyrris KAI UI

### Modificar: `client/src/pages/UsageSystem.tsx`

**Agregar nuevas columnas a la tabla:**
- Invoices
- Projects
- Payments
- Emails Sent
- PDFs Generated

**Agregar nuevas métricas globales:**
- Total Invoices
- Total Projects
- Total Payments
- Emails Sent (Today/Month) con alerta al 80%
- PDFs Generated (Today/Month)

---

## 📋 Checklist de Implementación

### Fase 1: Owl Fenc App
- [ ] Crear `server/services/emailTrackingService.ts`
- [ ] Crear `server/services/pdfTrackingService.ts`
- [ ] Integrar tracking en `invoiceEmailService.ts`
- [ ] Integrar tracking en `invoice-pdf-service.ts`
- [ ] Integrar tracking en `unifiedPdfService.ts`
- [ ] Integrar tracking en `permitReportGenerator.ts`
- [ ] Crear script de migración para estandarizar `userId`
- [ ] Ejecutar migración en Firestore
- [ ] Probar tracking con invoice real

### Fase 2: Chyrris KAI
- [ ] Actualizar `getUserUsageBreakdown()` con todas las colecciones
- [ ] Actualizar `getSystemUsageMetrics()` con emails y PDFs
- [ ] Actualizar UI de Usage System con nuevas columnas
- [ ] Agregar alertas visuales para límites (80%, 90%, 95%)
- [ ] Probar con datos reales
- [ ] Guardar checkpoint

---

## 🚨 Alertas Automáticas

### Configurar notificaciones cuando:
1. **Emails > 400/día (80%)** → Warning
2. **Emails > 450/día (90%)** → Critical
3. **Emails > 475/día (95%)** → Emergency - Upgrade Resend plan
4. **PDFs > 1000/mes** → Revisar costos de servicio PDF

---

## 📊 Dashboards Finales

### Usage System mostrará:

**Global Metrics:**
```
📧 Emails Sent Today: 127 / 500 (25.4%)
📄 PDFs Generated (Month): 342
👥 Active Users: 7
🔢 Total Operations: 1,367
```

**Per-User Table:**
```
User              | Clients | Contracts | Invoices | Estimates | Projects | Payments | Emails | PDFs | Total
------------------|---------|-----------|----------|-----------|----------|----------|--------|------|------
Gelasio Sanchez   | 308     | 0         | 25       | 64        | 12       | 8        | 45     | 89   | 551
Mervin Rodriguez  | 150     | 2         | 10       | 30        | 5        | 3        | 20     | 42   | 262
...
```

---

## ✅ Resultado Final

Con este sistema tendrás:
✅ Control total de operaciones por usuario
✅ Alertas antes de llegar a límites de servicios
✅ Datos precisos para billing
✅ Identificación de usuarios con alto uso
✅ Tracking completo de emails (Resend)
✅ Tracking completo de PDFs generados
✅ Campos estandarizados en todas las colecciones
