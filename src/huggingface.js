// Gera imagem via Hugging Face (FLUX.1 Kontext, roteado pelo fal-ai) usando a
// chave compartilhada do servidor - o cliente (plugin) nunca ve esse token,
// so manda prompt + imagem e recebe o resultado pronto.
// O prefixo "fal-ai" aparece duas vezes de proposito: o primeiro escolhe o
// provedor dentro do roteador da HF, o resto e o caminho nativo do modelo no
// fal.ai (que por acaso tambem comeca com "fal-ai/"). Confirmado via teste
// direto - sem duplicar, a HF responde "Model not supported by provider".
const PROVIDER_MODEL_PATH = 'fal-ai/fal-ai/flux-kontext/dev';

// Regras de fidelidade em ingles na frente do prompt do plugin. O Kontext
// segue instrucao em ingles bem melhor que em portugues, e o estilo do plugin
// (ex.: "luz entrando pelas janelas") fazia ele inventar janela, TV e luminaria.
// Testado na mesma captura: sem isso o espelho virava TV e a parede ganhava
// janela; com isso, parede lisa e espelho refletindo a cena. Fica no servidor
// para valer tambem para os plugins ja instalados.
const FIDELITY_RULES = [
  'Convert this SketchUp 3D model screenshot into a photorealistic architectural photograph, as if shot by a professional photographer from the exact same camera position.',
  'Keep the scene exactly as modeled: same camera angle and framing, same walls, floor and ceiling, and every piece of furniture and object in the same position, size, shape and count. Keep the material, texture pattern and color of every surface exactly as modeled; only make them look real with realistic lighting, shadows and reflections.',
  'Do not add anything that is not in the model: no windows, doors, curtains, TVs, screens, lamps, light fixtures, paintings, plants, rugs or decorations. A wall without openings must stay without openings. Do not remove or replace any object, and do not change what an object is.'
].join('\n');

// Panorama 360 precisa inventar o que esta fora do enquadramento capturado.
function buildPrompt(userPrompt, inventory = '') {
  if (/panorama\s*360/i.test(userPrompt)) return userPrompt;
  const parts = [FIDELITY_RULES];
  if (inventory) {
    // So a lista nomeia objetos: qualquer palavra solta aqui (ex.: "mirror",
    // "wood") contamina a imagem inteira - nos testes os quadros viraram
    // espelho e a comoda branca virou madeira por causa de exemplos assim.
    parts.push(`Objects in the model (identified from the screenshot; keep exactly these, with these colors, in the same places, and nothing else):\n${inventory}`);
  }
  parts.push(`Style and lighting notes (Portuguese; ignore anything that conflicts with the rules above):\n${userPrompt}`);
  return parts.join('\n\n');
}

// Um modelo de visao olha a captura antes do render e diz o que cada coisa e.
// Sem isso, o painel azul chapado que o SketchUp usa para espelho vira TV em
// 3 de cada 4 renders; dizendo "isto e um espelho", acertou 2 de 2. Nos testes
// o Qwen2.5-VL identificou o espelho; Llama 4 Scout disse TV e Gemma 3 ficou
// em duvida. Qualquer falha aqui so tira a lista, nunca impede o render.
const VISION_MODEL = 'Qwen/Qwen2.5-VL-72B-Instruct';
const VISION_QUESTION = [
  'This is a screenshot of an untextured SketchUp 3D model (interior or building exterior).',
  'List every distinct object and architectural element visible: walls, floor, ceiling, openings and each piece of furniture or decor.',
  'SketchUp convention: mirrors and glass are drawn as flat light-blue or translucent blue panels, while TVs and screens are drawn as black or dark panels.',
  'So a light-blue panel in a frame standing on furniture or hung on a wall is a mirror; a light-blue panel set into a wall opening or a door, with something visible through it, is a window or glass door.',
  'Never call a light-blue panel a TV or screen. Name sculptures, stones and irregular shapes for what they look like.',
  'State whether each wall is plain or has openings. Do not invent anything that is not visible.',
  'Answer in English, one short line per item: "- <what it is>, <where it is in the image>, <color>". Give the color only for walls, floor, ceiling and furniture.'
].join(' ');

async function describeScene(imageBase64, apiKey) {
  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 400,
        temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'text', text: VISION_QUESTION },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
        ] }]
      })
    });
    if (!response.ok) {
      console.error(`[describeScene] HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return '';
    }
    const text = (await response.json())?.choices?.[0]?.message?.content || '';
    return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-')).slice(0, 30)
      // O azul-claro e so a cor que o SketchUp usa para vidro; deixado na
      // lista, o Kontext pinta a moldura do espelho de azul.
      .map((l) => (/\b(mirror|window|glass)\b/i.test(l) ? l.replace(/,\s*(light[- ]?blue|blue|translucent[^,]*)\s*$/i, '') : l))
      .join('\n');
  } catch (err) {
    console.error('[describeScene] falhou, seguindo sem a lista:', err.message);
    return '';
  }
}

async function generateImage({ prompt, imageBase64 }) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY nao configurado no .env do backend.');

  const inventory = /panorama\s*360/i.test(prompt) ? '' : await describeScene(imageBase64, apiKey);
  console.log(`[render] inventario da cena:\n${inventory || '(vazio)'}`);

  const response = await fetch(`https://router.huggingface.co/${PROVIDER_MODEL_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: buildPrompt(prompt, inventory),
      image_url: `data:image/png;base64,${imageBase64}`,
      num_inference_steps: 50,
      // guidance_scale mais baixo faz o Kontext seguir mais a imagem de
      // referencia e menos o "clima" descrito no texto - testado lado a lado
      // (3.5 x 2.0) em duas cenas reais, 2.0 manteve moveis/objetos muito
      // mais fieis e nao perdeu qualidade do render.
      guidance_scale: 2.0,
      output_format: 'png',
      resolution_mode: 'match_input'
    })
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.ok && contentType.startsWith('image/')) {
    return Buffer.from(await response.arrayBuffer());
  }

  if (response.ok && contentType.includes('json')) {
    const parsed = await response.json();
    const imageUrl = parsed?.images?.[0]?.url || parsed.image_url || parsed?.image?.url;
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (imgRes.ok) return Buffer.from(await imgRes.arrayBuffer());
    }
  }

  const bodyText = await response.text().catch(() => '');
  if (bodyText.includes('loading')) {
    throw new Error('O modelo esta carregando no servidor da Hugging Face (acontece no primeiro uso). Tente de novo em uns 30s.');
  }
  throw new Error(`Erro da Hugging Face (HTTP ${response.status}): ${bodyText.slice(0, 300)}`);
}

module.exports = { generateImage, buildPrompt, describeScene };
