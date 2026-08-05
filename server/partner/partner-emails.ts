/**
 * Partner Portal — transactional emails (Resend)
 *
 * Uses the shared Resend client from services/config (RESEND_API_KEY env var,
 * NEVER in the repo). The sender must be a Resend-verified domain; configure
 * PARTNER_EMAIL_FROM in Railway (e.g. "LeadPrime <no-reply@chyrris.com>").
 */
import { resend } from "../services/config";

const BRAND = {
  navy: "#0B1A2B",
  blue: "#2E8BE6",
  green: "#2AA875",
  gold: "#C79A45",
  bg: "#F4F7F9",
};

/** Escape values interpolated into email HTML (defense in depth). */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getFrom(): string {
  return process.env.PARTNER_EMAIL_FROM || "LeadPrime <no-reply@chyrris.com>";
}

function getPortalUrl(): string {
  return process.env.PARTNER_PORTAL_URL || "https://partners.chyrris.com";
}

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(11,26,43,0.08);">
        <tr>
          <td style="background:${BRAND.navy};padding:22px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px;">LEAD<span style="color:${BRAND.blue};">PRIME</span></span>
            <span style="color:#8fa8c0;font-size:12px;letter-spacing:1px;display:block;margin-top:2px;">PORTAL DE SOCIOS</span>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;color:${BRAND.navy};font-size:20px;">${title}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 32px;background:${BRAND.bg};color:#7b8a99;font-size:12px;">
          <span style="display:block;color:#9aa8b5;font-style:italic;margin-bottom:6px;">El que no vive para servir, no sirve para vivir.</span>
          Este correo fue enviado por el programa de socios de LeadPrime.
          Si no esperabas este mensaje, puedes ignorarlo.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Whether transactional email can be sent at all (RESEND_API_KEY present). */
export function isPartnerEmailConfigured(): boolean {
  return Boolean(resend);
}

/**
 * Sent ONCE when a partner finishes the 3-stage onboarding journey. This is the
 * moment the referrals dashboard unlocks, so the email doubles as the welcome
 * to the program proper and hands them their referral links.
 *
 * The caller claims the send atomically (referral_partners.welcome_email_sent_at)
 * before calling this, so it can never go out twice.
 */
export async function sendPartnerOnboardingCompleteEmail(params: {
  to: string;
  partnerName: string;
  contactName?: string | null;
  referralLink: string;
  shortLink: string;
  tierYear1Pct: string;
  tierYear2Pct: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[Partner Emails] Resend not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const portalUrl = getPortalUrl();
    const greeting = params.contactName ? `${esc(params.contactName)},` : "¡Hola!";
    const year1 = esc(String(Number(params.tierYear1Pct)));
    const year2 = esc(String(Number(params.tierYear2Pct)));
    const html = layout(
      "Tu registro está completo",
      `<p style="color:#3d4a58;font-size:15px;line-height:1.6;">${greeting}</p>
       <p style="color:#3d4a58;font-size:15px;line-height:1.6;">Completaste las tres etapas y <strong>${esc(params.partnerName)}</strong> ya es socio activo de LeadPrime. Tu panel de referidos y comisiones está desbloqueado.</p>

       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
         <tr><td style="border-left:4px solid ${BRAND.gold};background:${BRAND.bg};padding:18px 20px;border-radius:0 10px 10px 0;">
           <p style="margin:0;color:${BRAND.navy};font-size:16px;line-height:1.5;font-style:italic;">El que no vive para servir, no sirve para vivir.</p>
         </td></tr>
       </table>

       <p style="color:#3d4a58;font-size:15px;line-height:1.6;">Eso es exactamente lo que empieza hoy. Cada contratista que llegue a LeadPrime por tu recomendación es alguien a quien le abres una puerta: más trabajo, mejor organización, un negocio que crece. La comisión es la consecuencia, no el objetivo. Sirve bien y lo demás llega solo.</p>

       <p style="color:#3d4a58;font-size:15px;line-height:1.6;">Tu enlace de referido — compártelo con confianza:</p>
       <div style="margin:16px 0;">
         <div style="background:${BRAND.bg};border:1px solid #dbe4ec;border-radius:10px;padding:12px 16px;margin-bottom:8px;">
           <span style="display:block;color:#7b8a99;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Enlace corto (para tu bio)</span>
           <a href="${esc(params.shortLink)}" style="color:${BRAND.blue};font-size:15px;font-weight:bold;text-decoration:none;word-break:break-all;">${esc(params.shortLink.replace(/^https?:\/\//, ""))}</a>
         </div>
         <div style="background:${BRAND.bg};border:1px solid #dbe4ec;border-radius:10px;padding:12px 16px;">
           <span style="display:block;color:#7b8a99;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Enlace completo</span>
           <a href="${esc(params.referralLink)}" style="color:${BRAND.blue};font-size:13px;text-decoration:none;word-break:break-all;">${esc(params.referralLink)}</a>
         </div>
       </div>

       <p style="color:#3d4a58;font-size:14px;line-height:1.6;">Ganas <strong>${year1}%</strong> de lo que cada referido pague durante su primer año, y <strong>${year2}%</strong> durante el segundo. Puedes seguirlo todo en tiempo real desde tu portal.</p>

       <div style="text-align:center;margin:28px 0;">
         <a href="${portalUrl}" style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:10px;">Ver mi panel de referidos</a>
       </div>

       <p style="color:#7b8a99;font-size:12px;line-height:1.6;">Bienvenido de verdad. Cualquier cosa que necesites, estamos de tu lado.</p>`
    );
    const result = await resend.emails.send({
      from: getFrom(),
      to: params.to,
      subject: "¡Listo! Ya eres socio activo de LeadPrime",
      html,
    });
    if (result.error) {
      console.error("[Partner Emails] Welcome send failed:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (error: any) {
    console.error("[Partner Emails] Welcome send error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendPartnerOtpEmail(
  to: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[Partner Emails] Resend not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const html = layout(
      "Tu código de acceso",
      `<p style="color:#3d4a58;font-size:14px;line-height:1.6;">Usa este código para entrar al Portal de Socios de LeadPrime. Expira en <strong>10 minutos</strong>.</p>
       <div style="text-align:center;margin:24px 0;">
         <span style="display:inline-block;background:${BRAND.bg};border:1px solid #dbe4ec;border-radius:10px;padding:14px 28px;font-size:30px;font-weight:bold;letter-spacing:10px;color:${BRAND.navy};">${code}</span>
       </div>
       <p style="color:#7b8a99;font-size:12px;line-height:1.6;">Nunca compartas este código. Nadie de LeadPrime te lo pedirá.</p>`
    );
    const result = await resend.emails.send({
      from: getFrom(),
      to,
      subject: `${code} es tu código del Portal de Socios LeadPrime`,
      html,
    });
    if (result.error) {
      console.error("[Partner Emails] OTP send failed:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (error: any) {
    console.error("[Partner Emails] OTP send error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendPartnerInvitationEmail(
  to: string,
  partnerName: string,
  contactName?: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[Partner Emails] Resend not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const portalUrl = getPortalUrl();
    const greeting = contactName ? `Hola ${esc(contactName)},` : "Hola,";
    const html = layout(
      "Bienvenido al programa de socios de LeadPrime",
      `<p style="color:#3d4a58;font-size:14px;line-height:1.6;">${greeting}</p>
       <p style="color:#3d4a58;font-size:14px;line-height:1.6;"><strong>${esc(partnerName)}</strong> ya forma parte del programa de socios de LeadPrime. Desde tu portal podrás completar tu registro (contrato, W-9 y depósito ACH), obtener tu enlace de referido y seguir tus referidos y comisiones en tiempo real.</p>
       <div style="text-align:center;margin:28px 0;">
         <a href="${portalUrl}" style="display:inline-block;background:${BRAND.blue};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:10px;">Activar mi acceso</a>
       </div>
       <p style="color:#3d4a58;font-size:13px;line-height:1.6;">Para entrar solo necesitas tu correo: te enviaremos un código de acceso de un solo uso (sin contraseñas).</p>
       <p style="color:#7b8a99;font-size:12px;line-height:1.6;">Enlace del portal: <a href="${portalUrl}" style="color:${BRAND.blue};">${portalUrl.replace(/^https?:\/\//, "")}</a></p>`
    );
    const result = await resend.emails.send({
      from: getFrom(),
      to,
      subject: "Tu acceso al Portal de Socios de LeadPrime",
      html,
    });
    if (result.error) {
      console.error("[Partner Emails] Invitation send failed:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (error: any) {
    console.error("[Partner Emails] Invitation send error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Referral invitation to a partner's graduate (brief §5). The link carries the
 * partner's attribution; the graduate registers themselves (their consent).
 */
export async function sendReferralInvitationEmail(
  to: string,
  partnerName: string,
  signupLink: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[Partner Emails] Resend not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const html = layout(
      "Te invitaron a LeadPrime",
      `<p style="color:#3d4a58;font-size:14px;line-height:1.6;"><strong>${esc(partnerName)}</strong> te invita a unirte a <strong>LeadPrime</strong>, la plataforma que ayuda a los contratistas a conseguir y gestionar más trabajo.</p>
       <p style="color:#3d4a58;font-size:14px;line-height:1.6;">Crea tu cuenta con este enlace personalizado. Al registrarte, tu cuenta queda vinculada a quien te invitó.</p>
       <div style="text-align:center;margin:28px 0;">
         <a href="${signupLink}" style="display:inline-block;background:${BRAND.blue};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:10px;">Crear mi cuenta en LeadPrime</a>
       </div>
       <p style="color:#7b8a99;font-size:12px;line-height:1.6;">Si el botón no funciona, copia este enlace: <a href="${signupLink}" style="color:${BRAND.blue};">${signupLink}</a></p>`
    );
    const result = await resend.emails.send({
      from: getFrom(),
      to,
      subject: `${partnerName} te invitó a LeadPrime`.replace(/[\r\n]/g, " "),
      html,
    });
    if (result.error) {
      console.error("[Partner Emails] Referral invitation send failed:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (error: any) {
    console.error("[Partner Emails] Referral invitation send error:", error);
    return { success: false, error: error.message };
  }
}
