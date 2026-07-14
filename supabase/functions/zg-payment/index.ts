import { corsHeaders } from '../_shared/cors.ts';
import { requireOrganizationMember } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    const successUrl = Deno.env.get('PAYMENT_SUCCESS_URL');
    const cancelUrl = Deno.env.get('PAYMENT_CANCEL_URL');
    if (!key || !successUrl || !cancelUrl) throw new Error('Stripe 环境变量尚未配置');
    const { amount, description, workOrderId, organizationId } = await request.json();
    await requireOrganizationMember(request, String(organizationId || ''));
    if (!amount || amount < 50) throw new Error('付款金额不正确');
    const params = new URLSearchParams();
    params.set('mode', 'payment'); params.set('success_url', successUrl); params.set('cancel_url', cancelUrl);
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][product_data][name]', description || 'Z&G AUTO REPAIR Invoice');
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(amount)));
    params.set('line_items[0][quantity]', '1'); params.set('metadata[work_order_id]', workOrderId || '');
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || '付款链接创建失败');
    return new Response(JSON.stringify({ id: result.id, url: result.url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
