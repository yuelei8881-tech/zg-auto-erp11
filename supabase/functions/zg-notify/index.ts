import { corsHeaders } from '../_shared/cors.ts';
import { requireOrganizationMember } from '../_shared/auth.ts';

type Channel = 'email' | 'sms';

class NotifyError extends Error {
  status: number;
  code: string;
  channel?: Channel;

  constructor(message: string, status = 400, code = 'NOTIFICATION_ERROR', channel?: Channel) {
    super(message);
    this.status = status;
    this.code = code;
    this.channel = channel;
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function detectChannel(body: Record<string, unknown>): Channel {
  const requested = String(body.channel || body.type || '').trim().toLowerCase();
  if (requested === 'email' || requested === 'sms') return requested;
  if (requested) throw new NotifyError('不支持的通知通道。', 400, 'INVALID_CHANNEL');
  // Backward compatibility: older clients did not always send channel.
  return body.subject || body.html ? 'email' : 'sms';
}

async function sendEmail(body: Record<string, unknown>) {
  const to = String(body.to || '').trim();
  const subject = String(body.subject || '').trim();
  const html = String(body.html || '').trim();
  if (!to || !subject || !html) {
    throw new NotifyError('缺少收件邮箱、主题或邮件内容。', 400, 'EMAIL_FIELDS_REQUIRED', 'email');
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM') || Deno.env.get('RESEND_FROM') || 'Z&G AUTO REPAIR <service@zgautorepair.com>';
  if (!resendKey) {
    throw new NotifyError('邮件服务尚未配置 RESEND_API_KEY。', 503, 'EMAIL_NOT_CONFIGURED', 'email');
  }

  const rawAttachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
  const attachments = rawAttachments.map((item, index) => {
    const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const content = String(value.content || '').replace(/^data:[^;]+;base64,/, '');
    if (!content || content.length > 6_000_000) throw new NotifyError(`附件 ${index + 1} 无效或过大。`, 413, 'ATTACHMENT_TOO_LARGE', 'email');
    return {
      filename: String(value.filename || `evidence-${index + 1}.jpg`).replace(/[^\w.()-]/g, '_'),
      content,
      content_id: String(value.contentId || `evidence-${index + 1}`),
    };
  });
  if (attachments.reduce((sum, item) => sum + item.content.length, 0) > 20_000_000) {
    throw new NotifyError('证据照片附件总大小过大，请减少照片数量。', 413, 'ATTACHMENTS_TOO_LARGE', 'email');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: emailFrom, to: [to], subject, html, ...(attachments.length ? { attachments } : {}) }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new NotifyError(String(result.message || result.error || '邮件发送失败。'), response.status, 'EMAIL_PROVIDER_ERROR', 'email');
  }
  return { id: result.id, status: 'sent', channel: 'email' };
}

async function sendSms(body: Record<string, unknown>) {
  const rawTo = String(body.to || '').trim();
  const digits = rawTo.replace(/\D/g, '');
  const to = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : rawTo;
  let message = String(body.message || '').trim();
  if (!to || !message) {
    throw new NotifyError('缺少收件号码或短信内容。', 400, 'SMS_FIELDS_REQUIRED', 'sms');
  }

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM_NUMBER');
  const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
  if (!sid || !token || (!from && !messagingServiceSid)) {
    throw new NotifyError('短信服务尚未配置 Twilio。', 503, 'SMS_NOT_CONFIGURED', 'sms');
  }

  if (!/reply\s+stop|回复\s*stop/i.test(message)) message += '\nReply STOP to opt out.';
  if (message.length > 1200) throw new NotifyError('短信内容过长，请缩短后重试。', 400, 'SMS_TOO_LONG', 'sms');
  const params = new URLSearchParams({ To: to, Body: message });
  if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
  else params.set('From', String(from));
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new NotifyError(String(result.message || result.error || '短信发送失败。'), response.status, 'SMS_PROVIDER_ERROR', 'sms');
  }
  return { id: result.sid, status: result.status || 'sent', channel: 'sms' };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await request.json() as Record<string, unknown>;
    await requireOrganizationMember(request, String(body.organizationId || ''));
    const channel = detectChannel(body);
    return json(channel === 'email' ? await sendEmail(body) : await sendSms(body));
  } catch (error) {
    const known = error instanceof NotifyError ? error : null;
    return json({
      error: error instanceof Error ? error.message : String(error),
      code: known?.code || 'INTERNAL_ERROR',
      channel: known?.channel || null,
    }, known?.status || 500);
  }
});
