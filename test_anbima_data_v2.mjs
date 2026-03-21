import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const apiResults = {};

// Interceptar respostas para capturar dados de taxas
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('data-api.prd.anbima.com.br')) {
    try {
      const body = await response.text();
      apiResults[url] = { status: response.status(), data: body.substring(0, 1000) };
    } catch(e) {}
  }
});

// Acessar página de taxas da NTN-B
console.log('Acessando NTN-B taxas...');
await page.goto('https://data.anbima.com.br/titulos-publicos/NTN-B/taxas', { 
  waitUntil: 'domcontentloaded', 
  timeout: 45000 
});

// Aguardar mais tempo para o Firebase inicializar
await page.waitForTimeout(8000);

// Tentar capturar o token do IndexedDB
const tokenResult = await page.evaluate(async () => {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
          resolve({ error: 'store not found', stores: Array.from(db.objectStoreNames) });
          return;
        }
        const tx = db.transaction('firebaseLocalStorage', 'readonly');
        const store = tx.objectStore('firebaseLocalStorage');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const items = getAll.result;
          let token = null;
          for (const item of items) {
            if (item?.value?.stsTokenManager?.accessToken) {
              token = item.value.stsTokenManager.accessToken;
              break;
            }
          }
          resolve({ token: token ? token.substring(0, 100) + '...' : null, itemCount: items.length });
        };
        getAll.onerror = () => resolve({ error: 'getAll failed' });
      };
      req.onerror = () => resolve({ error: 'indexedDB open failed' });
    } catch(e) {
      resolve({ error: e.message });
    }
  });
}).catch(e => ({ error: e.message }));

console.log('Token result:', JSON.stringify(tokenResult));

// Aguardar mais chamadas de API
await page.waitForTimeout(5000);

console.log('\n=== Intercepted API Results ===');
for (const [url, data] of Object.entries(apiResults)) {
  console.log(`\nURL: ${url}`);
  console.log(`Status: ${data.status}`);
  console.log(`Data: ${data.data.substring(0, 400)}`);
}

// Tentar fazer chamada de API dentro do contexto da página com token real
if (Object.keys(apiResults).length > 0) {
  const firstUrl = Object.keys(apiResults)[0];
  console.log('\n=== Tentando chamada de API com token real ===');
  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onsuccess = async (e) => {
        const db = e.target.result;
        const tx = db.transaction('firebaseLocalStorage', 'readonly');
        const store = tx.objectStore('firebaseLocalStorage');
        const getAll = store.getAll();
        getAll.onsuccess = async () => {
          let token = null;
          for (const item of getAll.result) {
            if (item?.value?.stsTokenManager?.accessToken) {
              token = item.value.stsTokenManager.accessToken;
              break;
            }
          }
          if (!token) { resolve({ error: 'no token' }); return; }
          
          // Testar NTN-B
          const r = await fetch('https://data-api.prd.anbima.com.br/web-bff/v1/titulos-publicos/NTN-B/taxas', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await r.text();
          resolve({ status: r.status, data: data.substring(0, 600), tokenLen: token.length });
        };
      };
    });
  }).catch(e => ({ error: e.message }));
  
  console.log(JSON.stringify(result, null, 2));
}

await browser.close();
