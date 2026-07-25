# Cambios para el repo de LeadPrime (`g3lasio/leadprime`) — hand-off

> ⚠️ **Estos cambios NO están en Kai. Viven en el repo/app de LeadPrime**
> (`leadprime.chyrris.com`), porque tocan el dominio y el signup de LeadPrime,
> no el portal de socios. **Gelasio revisa antes de aplicar a producción.**
> Tocan el producto principal (el signup de contratistas que ya funciona), así
> que la regla es: **no romper el signup existente.**

Son **dos cambios agrupados** (ambos sobre el mismo flujo de signup):

1. **Captura de `?ref=CODE`** (ya requerido desde la v1 del portal).
2. **Redirect del link corto `/r/CODE`** (nuevo, para bios de redes).

El motor de comisión de Kai ya está listo para recibir la atribución por
cualquiera de las dos vías. Kai **no** cambia con esto — solo muestra el link
corto; el redirect es responsabilidad de LeadPrime.

---

## 1. Captura de `?ref=CODE` en el signup

Cuando un contratista llega a `leadprime.chyrris.com/signup?ref=CODE`:

1. Leer `ref` del query string.
2. Guardarlo en **cookie + localStorage con ventana de 30 días** (para que la
   atribución sobreviva si el registro no es inmediato).
3. Al **crear la cuenta**, persistir el código en `contractors.referral_code`
   (columna nullable ya provista: ver `scripts/leadprime-add-referral-code.sql`
   en el repo de Kai) **o** llamar al endpoint de Kai
   `POST https://kai.chyrris.com/api/referrals/attribute` con header
   `X-Referral-Secret: <REFERRAL_WEBHOOK_SECRET>`.
   **Recomendado: la vía de la columna** — Kai barre `contractors.referral_code`
   automáticamente cada 6 h; no requiere secreto ni llamada de red.

```js
// Al cargar /signup (front del signup de LeadPrime)
const ref = new URLSearchParams(location.search).get("ref");
if (ref) {
  const v = ref.trim().toUpperCase();
  document.cookie = `lp_ref=${encodeURIComponent(v)};path=/;max-age=${30*24*3600};samesite=lax`;
  localStorage.setItem("lp_ref", v);
}

// Al crear la cuenta (backend), tomar el ref de cookie/localStorage/campo oculto
// y guardarlo en contractors.referral_code (idempotente: solo si viene y la
// cuenta aún no tiene código).
```

## 2. Redirect del link corto `/r/CODE`

Meta: `leadprime.chyrris.com/r/prime` → **302** a
`leadprime.chyrris.com/signup?ref=PRIME`, preservando la atribución. La
atribución es **idéntica** a entrar por `?ref=PRIME` (Manus lo valida en Neon:
ambos caminos producen la misma fila de atribución).

Detalles:

- **Prefijo `/r/`** — limpio y sin colisión con rutas del sitio. Si `/r/`
  chocara con algo existente, usar un prefijo equivalente (`/go/`, `/ref/`) y
  documentarlo; entonces actualizar en Kai el ajuste
  **"Base del link corto de referido"** (Admin → Socios → ⚙ Ajustes) para que
  el portal muestre el prefijo correcto.
- El código en la URL puede venir en **minúsculas** (`/r/prime`) — la
  atribución es case-insensitive; normalizar a mayúsculas al pasar a `?ref=`.
- **301 vs 302:** usar **302** (temporal). Un 301 lo cachea el navegador de
  forma permanente y complica cambios futuros del destino.
- **Preservar la ventana de 30 días:** el redirect entrega el `?ref=` al
  signup, que ejecuta la captura del punto 1 (cookie/localStorage 30 días). Así
  el link corto se comporta idéntico al largo: clic hoy, registro en 3 días,
  atribución intacta.
- Códigos desconocidos → redirigir al `/signup` normal (sin `ref`), nunca 404.

### Ejemplo Express (adaptar al router real de LeadPrime)

```js
// backend/src/routes/publicReferral.ts  (o donde vivan las rutas públicas)
// Montar ANTES del catch-all de la SPA. No tocar el resto del signup.
app.get("/r/:code", (req, res) => {
  const raw = String(req.params.code || "").trim();
  // Validación defensiva: solo alfanumérico + - _ , máx 30
  if (!raw || raw.length > 30 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return res.redirect(302, "/signup");
  }
  const code = raw.toUpperCase();
  // (Opcional) verificar que el código exista/está activo antes de redirigir.
  return res.redirect(302, `/signup?ref=${encodeURIComponent(code)}`);
});
```

Si LeadPrime es Next.js en vez de Express, el equivalente es un
`redirects()` dinámico en `next.config.js` o un route handler
`app/r/[code]/route.ts` que haga `NextResponse.redirect(new URL('/signup?ref=' + code.toUpperCase(), req.url), 302)`.

---

## Validación (Manus, en Neon real)

1. `leadprime.chyrris.com/r/prime` responde **302** a `/signup?ref=PRIME`.
2. Un contratista de prueba que entra por `/r/prime` y se registra queda
   atribuido a **Prime** — **exactamente igual** que uno que entra por
   `?ref=PRIME` (misma fila en `referral_attributions`, verificable con query
   directa en Neon).
3. La ventana de 30 días funciona igual por el link corto (clic → registro
   días después → atribución intacta).
4. **El signup de contratistas sigue funcionando sin regresión** (el flujo
   orgánico, sin `ref`, no cambia).
5. En el portal del socio, el link corto se muestra como el principal para
   compartir (ya implementado en Kai).

## Checklist de seguridad para el cambio en LeadPrime

- [ ] La ruta `/r/:code` se monta **antes** del catch-all de la SPA.
- [ ] `/r/CODE` solo hace redirect; **no** crea cuentas ni toca dinero.
- [ ] Códigos inválidos/desconocidos → `/signup` (nunca error/404).
- [ ] El flujo de signup existente (sin `ref`) queda **idéntico**.
- [ ] Revisión de Gelasio antes de merge a producción.
