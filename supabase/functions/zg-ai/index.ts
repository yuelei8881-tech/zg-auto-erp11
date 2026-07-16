import { corsHeaders } from '../_shared/cors.ts';
import { requireOrganizationMember } from '../_shared/auth.ts';

type OutputContent = { type?: string; text?: string };
type OutputItem = { content?: OutputContent[] };

function cleanSecret(value?: string) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[^\x20-\x7E]/g, '');
  return cleaned.match(/sk-[A-Za-z0-9_-]{20,}/)?.[0] || cleaned;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let stage = 'initializing';
  try {
    const key = cleanSecret(Deno.env.get('OPENAI_API_KEY'));
    if (!key) throw new Error('OPENAI_API_KEY 尚未配置');

    stage = 'reading_request';
    const body = await request.json();
    stage = 'authorizing_user';
    await requireOrganizationMember(request, String(body.organizationId || ''));

    const isPhoto = body.type === 'photo';
    const isTranslation = body.type === 'translation';
    const content = isTranslation
      ? [{
          type: 'input_text',
          text: `You are a professional automotive repair order translator. Translate the Chinese text into concise, accurate US automotive-service English for printing on a repair order. Preserve DTCs, VINs, part numbers, measurements, line breaks, and proper names. Do not add facts, diagnosis, advice, quotation marks, headings, or explanations. Return only the English translation. Section: ${body.context || 'repair order notes'}.\n\nChinese source:\n${body.prompt || ''}`,
        }]
      : isPhoto
        ? [
            { type: 'input_text', text: body.prompt || '识别汽车部位和损伤情况，并对照片进行分类。' },
            { type: 'input_image', image_url: body.image },
          ]
        : [{
            type: 'input_text',
            text: `你是汽修技术助手。请提供安全、分步骤的诊断建议，并明确指出需要核实的资料。不要假装拥有未提供的原厂资料。问题：${body.prompt || ''}`,
          }];

    stage = 'calling_openai';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-5-mini',
        input: [{ role: 'user', content }],
      }),
    });

    stage = 'reading_openai_response';
    const responseText = await response.text();
    let result: Record<string, any> = {};
    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error(`AI 服务返回了无法读取的内容（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      throw new Error(result.error?.message || `AI 服务返回错误（HTTP ${response.status}）`);
    }

    const answer = result.output_text
      || result.output?.flatMap((item: OutputItem) => item.content || [])
        .find((item: OutputContent) => item.type === 'output_text')?.text
      || '';
    if (!answer) throw new Error('AI 没有返回内容');

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[zg-ai]', { stage, message });
    return new Response(JSON.stringify({ error: message, stage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
