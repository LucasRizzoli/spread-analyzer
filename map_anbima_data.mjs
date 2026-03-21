import { chromium } from 'playwright';

const results = {};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Interceptar todas as chamadas de rede
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('data-api') || url.includes('anbima.com.br/api') || url.includes('firebase')) {
    try {
      const status = response.status();
      const body = await response.text().catch(() => '');
      results[url] = { status, preview: body.substring(0, 500) };
    } catch(e) {}
  }
});

console.log('Acessando ANBIMA Data - NTN-B...');
await page.goto('https://data.anbima.com.br/titulos-publicos/NTN-B/taxas', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('Acessando ANBIMA Data - Debêntures lista...');
await page.goto('https://data.anbima.com.br/debentures', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

// Tentar acessar uma debênture específica
console.log('Acessando ANBIMA Data - Debênture PETR14...');
await page.goto('https://data.anbima.com.br/debentures/PETR14/taxas', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('Acessando ANBIMA Data - CRI...');
await page.goto('https://data.anbima.com.br/cri', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

await browser.close();

console.log('\n=== ENDPOINTS INTERCEPTADOS ===');
for (const [url, data] of Object.entries(results)) {
  console.log(`\nURL: ${url}`);
  console.log(`Status: ${data.status}`);
  console.log(`Preview: ${data.preview.substring(0, 300)}`);
}
