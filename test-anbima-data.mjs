import { chromium } from 'playwright';

async function testAnbimaData(codigoCetip) {
  console.log(`Testing ANBIMA Data for ${codigoCetip}...`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  let capturedData = null;

  // Interceptar chamadas à API interna
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('data-api.prd.anbima.com.br') && url.toLowerCase().includes(codigoCetip.toLowerCase())) {
      try {
        const json = await response.json();
        console.log('Captured API URL:', url);
        console.log('Data preview:', JSON.stringify(json, null, 2).substring(0, 2000));
        capturedData = json;
      } catch(e) {
        // ignore
      }
    }
  });

  await page.goto(`https://data.anbima.com.br/debentures/${codigoCetip}/caracteristicas`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  await page.waitForTimeout(2000);

  if (!capturedData) {
    console.log('No data captured from API');
  } else {
    console.log('\n=== SUMMARY ===');
    // Extrair campos relevantes
    const d = capturedData;
    console.log('ISIN:', d.isin || d.codigo_b3 || 'N/A');
    console.log('LEI:', d.lei);
    if (d.emissao) {
      console.log('Numero Emissao:', d.emissao.numero_emissao);
      console.log('Serie:', d.emissao.serie);
      console.log('Data Emissao:', d.emissao.data_emissao);
      console.log('Data Vencimento:', d.emissao.data_vencimento);
      console.log('Remuneracao:', d.emissao.remuneracao);
      console.log('Indexador:', d.emissao.indexador);
      if (d.emissao.emissor) {
        console.log('Emissor:', d.emissao.emissor.nome);
        console.log('CNPJ:', d.emissao.emissor.cnpj);
        console.log('Setor:', d.emissao.emissor.setor);
      }
    }
  }

  await browser.close();
  return capturedData;
}

// Testar com AALM12
await testAnbimaData('AALM12');
console.log('\n--- Testing another debenture ---\n');
await testAnbimaData('AAJR11');
