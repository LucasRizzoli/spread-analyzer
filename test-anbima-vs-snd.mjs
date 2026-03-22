/**
 * Teste comparativo: SND (debentures.com.br) vs ANBIMA Data (web-bff)
 * Verifica se o ANBIMA Data fornece todos os campos necessários para substituir o SND
 *
 * Campos necessários pelo syncService:
 *   - numeroEmissao  → usado para cruzar com ratings da Moody's (campo crítico)
 *   - isin           → salvo no banco
 *   - serie          → salvo no banco como numeroSerie
 */
import { chromium } from 'playwright';
import https from 'https';

// Ativos para testar
const ATIVOS = ['AALM12', 'AAJR11', 'PETR17', 'VALE15', 'ITUB21'];

// ── SND ───────────────────────────────────────────────────────────────────────
async function fetchSnd(cetip) {
  return new Promise((resolve) => {
    const url = `https://www.debentures.com.br/exploreosnd/consultaadados/emissoesdedebentures/caracteristicas_e.asp?op_exc=N&ativo=${cetip}`;
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpreadAnalyzer/1.0)' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const lines = d.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.toUpperCase().startsWith(cetip.toUpperCase())) continue;
          const parts = trimmed.split('\t').map(s => s.trim());
          if (parts.length < 7) continue;
          resolve({
            source: 'SND',
            codigoCetip: parts[0],
            empresa: parts[1],
            serie: parts[2],
            numeroEmissao: parseInt(parts[3], 10),
            isin: parts[6],
          });
          return;
        }
        resolve({ source: 'SND', codigoCetip: cetip, error: 'not found' });
      });
    });
    req.on('error', e => resolve({ source: 'SND', codigoCetip: cetip, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ source: 'SND', codigoCetip: cetip, error: 'timeout' }); });
    req.end();
  });
}

// ── ANBIMA Data (web-bff via Playwright) ─────────────────────────────────────
async function fetchAnbimaData(context, cetip) {
  const page = await context.newPage();
  try {
    let apiData = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('data-api.prd.anbima.com.br') &&
          url.toLowerCase().includes(cetip.toLowerCase()) &&
          url.includes('caracteristicas')) {
        try {
          const json = await response.json();
          if (json && (json.isin || json.codigo_b3 || json.emissao)) {
            apiData = json;
          }
        } catch {}
      }
    });

    await page.goto(`https://data.anbima.com.br/debentures/${cetip}/caracteristicas`, {
      waitUntil: 'networkidle',
      timeout: 25000
    });
    await page.waitForTimeout(1500);

    if (!apiData) return { source: 'ANBIMA Data', codigoCetip: cetip, error: 'no data captured' };

    const d = apiData;
    const emissao = d.emissao || {};
    const emissor = emissao.emissor || {};

    return {
      source: 'ANBIMA Data',
      codigoCetip: cetip,
      isin: d.isin || d.codigo_b3 || null,
      empresa: emissor.nome || emissor.razao_social || null,
      serie: d.numero_serie || null,
      numeroEmissao: emissao.numero_emissao ? parseInt(String(emissao.numero_emissao), 10) : null,
      cnpj: emissor.cnpj || null,
      setor: d.setor || emissor.setor || null,
      dataEmissao: emissao.data_emissao || null,
      dataVencimento: d.data_vencimento || null,
      remuneracao: d.remuneracao || null,
      lei12431: d.lei === true,
    };
  } catch (err) {
    return { source: 'ANBIMA Data', codigoCetip: cetip, error: err.message };
  } finally {
    await page.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('=== Comparativo SND vs ANBIMA Data ===\n');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();

// Inicializar sessão ANBIMA Data
const initPage = await context.newPage();
await initPage.goto('https://data.anbima.com.br', { waitUntil: 'networkidle', timeout: 20000 });
await initPage.close();

for (const cetip of ATIVOS) {
  console.log(`\n--- ${cetip} ---`);

  // Buscar em paralelo
  const [snd, anbima] = await Promise.all([
    fetchSnd(cetip),
    fetchAnbimaData(context, cetip),
  ]);

  console.log('SND:');
  console.log('  numeroEmissao:', snd.numeroEmissao ?? snd.error);
  console.log('  isin:', snd.isin ?? '-');
  console.log('  serie:', snd.serie ?? '-');
  console.log('  empresa:', snd.empresa ?? '-');

  console.log('ANBIMA Data:');
  console.log('  numeroEmissao:', anbima.numeroEmissao ?? anbima.error);
  console.log('  isin:', anbima.isin ?? '-');
  console.log('  serie:', anbima.serie ?? '-');
  console.log('  empresa:', anbima.empresa ?? '-');
  console.log('  cnpj:', anbima.cnpj ?? '-');
  console.log('  setor:', anbima.setor ?? '-');
  console.log('  dataEmissao:', anbima.dataEmissao ?? '-');
  console.log('  dataVencimento:', anbima.dataVencimento ?? '-');
  console.log('  remuneracao:', anbima.remuneracao ?? '-');
  console.log('  lei12431:', anbima.lei12431 ?? '-');

  // Verificar consistência do campo crítico
  if (snd.numeroEmissao && anbima.numeroEmissao) {
    const match = snd.numeroEmissao === anbima.numeroEmissao;
    console.log(`  ✓ numeroEmissao match: ${match ? 'SIM ✅' : `NÃO ❌ (SND=${snd.numeroEmissao}, ANBIMA=${anbima.numeroEmissao})`}`);
  }
}

await browser.close();
console.log('\n=== Teste concluído ===');
