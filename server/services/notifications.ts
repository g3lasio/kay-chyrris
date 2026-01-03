import { resend } from './config';
import { getDb } from '../db';
import { notificationCampaigns, campaignRecipients } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { getOwlFencUsersByPlan } from './owlfenc-db';

export type CampaignType = 'announcement' | 'event' | 'update' | 'offer';
export type TargetAudience = 'all' | 'free' | 'patron' | 'master';

export interface CreateCampaignInput {
  title: string;
  message: string;
  type: CampaignType;
  targetAudience: TargetAudience;
  applicationId: number;
}

export interface CampaignResult {
  success: boolean;
  campaignId?: number;
  sentCount?: number;
  failedCount?: number;
  error?: string;
}

export async function createAndSendCampaign(input: CreateCampaignInput): Promise<CampaignResult> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  if (!resend) {
    return { success: false, error: 'Email service not configured' };
  }

  try {
    // Create campaign record
    const result = await db.insert(notificationCampaigns).values({
      name: input.title,
      subject: input.title,
      message: input.message,
      targetSegment: { plan: [input.targetAudience] },
      applicationId: input.applicationId,
      status: 'sending',
      createdBy: 1, // TODO: Get from context
      createdAt: new Date(),
    }).$returningId();

    const campaignId = result[0]?.id;
    const campaign = { id: campaignId };

    if (!campaign) {
      return { success: false, error: 'Failed to create campaign' };
    }

    // Get target users based on audience
    const users = await getTargetUsers(input.targetAudience);

    if (users.length === 0) {
      await db.update(notificationCampaigns)
        .set({ status: 'sent' as const, successfulSends: 0 })
        .where(eq(notificationCampaigns.id, campaign.id));
      
      return { success: true, campaignId: campaign.id, sentCount: 0, failedCount: 0 };
    }

    // Send emails
    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
      try {
        await resend.emails.send({
          from: 'Owl Fenc <mervin@owlfenc.com>',
          to: user.email,
          subject: input.title,
          html: generateEmailHTML(input.title, input.message, input.type),
        });

        // Record successful send
        await db.insert(campaignRecipients).values({
          campaignId: campaign.id,
          userId: user.id.toString(),
          userEmail: user.email,
          status: 'sent',
          sentAt: new Date(),
        });

        sentCount++;
      } catch (error) {
        console.error(`[Notifications] Failed to send to ${user.email}:`, error);
        
        // Record failed send
        await db.insert(campaignRecipients).values({
          campaignId: campaign.id,
          userId: user.id.toString(),
          userEmail: user.email,
          status: 'failed',
          sentAt: new Date(),
        });

        failedCount++;
      }
    }

    // Update campaign status
    await db.update(notificationCampaigns)
      .set({
        status: 'sent' as const,
        successfulSends: sentCount,
        failedSends: failedCount,
        sentAt: new Date(),
      })
      .where(eq(notificationCampaigns.id, campaign.id));

    return {
      success: true,
      campaignId: campaign.id,
      sentCount,
      failedCount,
    };
  } catch (error: any) {
    console.error('[Notifications] Campaign error:', error);
    return { success: false, error: error.message };
  }
}

async function getTargetUsers(audience: TargetAudience): Promise<Array<{ id: number; email: string }>> {
  try {
    if (audience === 'all') {
      // Get all users
      const users = await getOwlFencUsersByPlan(null);
      return users.map(u => ({ id: u.id, email: u.email }));
    } else {
      // Get users by specific plan
      const planMap: Record<string, string> = {
        free: 'free',
        patron: 'patron',
        master: 'master',
      };
      const plan = planMap[audience];
      const users = await getOwlFencUsersByPlan(plan);
      return users.map(u => ({ id: u.id, email: u.email }));
    }
  } catch (error) {
    console.error('[Notifications] Error getting target users:', error);
    return [];
  }
}

function generateEmailHTML(title: string, message: string, type: CampaignType): string {
  const typeColors: Record<CampaignType, string> = {
    announcement: '#3b82f6', // blue
    event: '#8b5cf6', // purple
    update: '#10b981', // green
    offer: '#f59e0b', // orange
  };

  const color = typeColors[type];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%); border: 1px solid ${color}40; border-radius: 16px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${color}20 0%, transparent 100%); padding: 40px 40px 30px 40px; border-bottom: 1px solid ${color}30;">
              <h1 style="margin: 0; color: ${color}; font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                ${title}
              </h1>
              <p style="margin: 10px 0 0 0; color: #888; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">
                ${type}
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px; color: #e0e0e0; font-size: 16px; line-height: 1.6;">
              ${message.split('\n').map(p => `<p style="margin: 0 0 16px 0;">${p}</p>`).join('')}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid ${color}20;">
              <p style="margin: 0; color: #666; font-size: 12px; text-align: center;">
                Sent from Owl Fenc Admin Dashboard
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function getCampaignHistory(limit: number = 50) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    const campaigns = await db.select()
      .from(notificationCampaigns)
      .orderBy(notificationCampaigns.createdAt)
      .limit(limit);

    return campaigns;
  } catch (error) {
    console.error('[Notifications] Error getting campaign history:', error);
    return [];
  }
}
