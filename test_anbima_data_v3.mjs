import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let firebaseToken = null;
const apiResults = {};

// Interceptar REQUESTS para capturar o token nos headers
page.on('request', async (request) => {
  const url = request.url();
  const headers = request.headers();
  
  // Capturar token dos headers das chamadas à API do ANBIMA Data
  if (url.includes('data-api.prd.anbima.com.br') && headers['authorization']) {
    const auth = headers['authorization'];
    if (auth.startsWith('Bearer ')) {
      firebaseToken = auth.replace('Bearer ', '');
      console.log(`[TOKEN CAPTURADO] ${firebaseToken.substring(0, 50)}...`);
    }
  }
});

// Interceptar RESPOSTAS para capturar dados
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('data-api.prd.anbima.com.br')) {
    try {
      const body = await response.text();
      apiResults[url] = { status: response.status(), data: body.substring(0, 800) };
    } catch(e) {}
  }
});

// Acessar página de taxas da NTN-B - aguardar mais tempo
console.log('Acessando NTN-B taxas...');
await page.goto('https://data.anbima.com.br/titulos-publicos/NTN-B/taxas', { 
  waitUntil: 'load', 
  timeout: 45000 
});

// Aguardar Firebase inicializar e fazer chamadas
console.log('Aguardando Firebase e chamadas de API...');
await page.waitForTimeout(12000);

console.log(`\nToken capturado: ${firebaseToken ? 'SIM (' + firebaseToken.length + ' chars)' : 'NÃO'}`);
console.log(`\nAPI calls interceptadas: ${Object.keys(apiResults).length}`);

for (const [url, data] of Object.entries(apiResults)) {
  console.log(`\nURL: ${url}`);
  console.log(`Status: ${data.status}`);
  console.log(`Data: ${data.data.substring(0, 500)}`);
}

// Se capturamos o token, testar outros endpoints
if (firebaseToken) {
  console.log('\n=== Testando outros endpoints com o token capturado ===');
  const BASE = 'https://data-api.prd.anbima.com.br/web-bff/v1';
  const endpoints = [
    '/titulos-publicos/NTN-B/taxas',
    '/titulos-publicos?tipo=NTN-B&view=precos&page=0&size=20',
    '/debentures/PETR14/taxas',
    '/debentures?view=precos&page=0&size=5',
    '/certificado-recebiveis?view=precos&page=0&size=5',
  ];
  
  for (const ep of endpoints) {
    const r = await fetch(BASE + ep, {
      headers: { 'Authorization': `Bearer ${firebaseToken}` }
    });
    const body = await r.text();
    console.log(`\n${ep} -> ${r.status}`);
    console.log(body.substring(0, 400));
  }
}

await browser.close();
