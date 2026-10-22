// Planos de venda do Archilume — espelha a tabela "Planos de venda e limites
// de ativação" do mapa (doc). Mude os números aqui quando os preços/limites
// forem ajustados; o resto do backend só lê deste arquivo.
// Precos em centavos de BRL (evita ponto flutuante). cycle 'annual' = 0 quando
// o plano nao vende anual (trial). Espelha a tabela "Planos de venda e
// limites de ativacao" do mapa (doc).
const PLANS = {
  trial: {
    label: 'Teste grátis',
    rendersPerMonth: 5,
    renewsMonthly: false, // consome o saldo uma vez só, não reseta
    activationsLimit: 1,
    modules: ['render_basico'],
    price: { monthly: 0, annual: 0 }
  },
  starter: {
    label: 'Starter',
    rendersPerMonth: 40,
    renewsMonthly: true,
    activationsLimit: 1,
    modules: ['render_basico'],
    price: { monthly: 4900, annual: 47000 }
  },
  pro: {
    label: 'Pro',
    rendersPerMonth: 200,
    renewsMonthly: true,
    activationsLimit: 2,
    modules: ['render_basico', 'upscale', '360', 'img3d'],
    price: { monthly: 19900, annual: 191000 }
  },
  studio: {
    label: 'Studio',
    rendersPerMonth: 500,
    renewsMonthly: true,
    activationsLimit: 5,
    modules: ['render_basico', 'upscale', '360', 'img3d', 'espelho', 'led'],
    price: { monthly: 34900, annual: 335000 }
  }
};

function getPlan(planId) {
  return PLANS[planId] || null;
}

module.exports = { PLANS, getPlan };
