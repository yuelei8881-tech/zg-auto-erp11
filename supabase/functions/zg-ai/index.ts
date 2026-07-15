import { corsHeaders } from '../_shared/cors.ts';
import { requireOrganizationMember } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('OPENAI_API_KEY 尚未配置');
    const body = await request.json();
    await requireOrganizationMember(request, String(body.organizationId || ''));
    const isPhoto = body.type === 'photo';
    const isTranslation = body.type === 'translation';
    const content = isTranslation ? [{
      type: 'input_text',
      text: `You are a professional automotive repair order translator. Translate the Chinese text into concise, accurate US automotive-service English for printing on a repair order. Preserve DTCs, VINs, part numbers, measurements, line breaks, and proper names. Do not add facts, diagnosis, advice, quotation marks, headings, or explanations. Return only the English translation. Section: ${body.context || 'repair order notes'}.\n\nChinese source:\n${body.prompt || ''}`,
    }] : isPhoto ? [
      { type: 'input_text', text: body.prompt || '识别汽车部位、损伤和照片分类。' },
      { type: 'input_image', image_url: body.image },
    ] : [{ type: 'input_text', text: `你是汽修技术助手。提供安全、分步骤、明确需要核实资料的诊断建议，不要假装拥有未提供的原厂资料。问题：${body.prompt}` }];
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini', input: [{ role: 'user', content }] }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'AI 服务返回错误');
    const answer = result.output_text
      || result.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
        .find((item: { type?: string; text?: string }) => item.type === 'output_text')?.text
      || '';
    if (!answer) throw new Error('AI 没有返回内容');
    return new Response(JSON.stringify({ answer }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
