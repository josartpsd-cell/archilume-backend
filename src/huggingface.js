// Gera imagem via Hugging Face (FLUX.1 Kontext, roteado pelo fal-ai) usando a
// chave compartilhada do servidor - o cliente (plugin) nunca ve esse token,
// so manda prompt + imagem e recebe o resultado pronto.
// O prefixo "fal-ai" aparece duas vezes de proposito: o primeiro escolhe o
// provedor dentro do roteador da HF, o resto e o caminho nativo do modelo no
// fal.ai (que por acaso tambem comeca com "fal-ai/"). Confirmado via teste
// direto - sem duplicar, a HF responde "Model not supported by provider".
const PROVIDER_MODEL_PATH = 'fal-ai/fal-ai/flux-kontext/dev';

async function generateImage({ prompt, imageBase64 }) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY nao configurado no .env do backend.');

  const response = await fetch(`https://router.huggingface.co/${PROVIDER_MODEL_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt,
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

module.exports = { generateImage };
