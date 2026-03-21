import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let capturedToken = null;
const apiResults = {};

// Interceptar respostas para capturar o token e dados de taxas
page.on('response', async (response) => {
  const url = response.url();
  
  // Capturar token de autenticação
  if (url.includes('identitytoolkit') || url.includes('securetoken')) {
    try {
      const body = await response.json().catch(() => null);
      if (body?.idToken) capturedToken = body.idToken;
    } catch(e) {}
  }
  
  // Capturar dados de taxas
  if (url.includes('data-api.prd.anbima.com.br') && (url.includes('taxas') || url.includes('precos'))) {
    try {
      const body = await response.text();
      apiResults[url] = { status: response.status(), data: body.substring(0, 800) };
    } catch(e) {}
  }
});

// Acessar página de taxas da NTN-B
console.log('Acessando NTN-B taxas...');
await page.goto('https://data.anbima.com.br/titulos-publicos/NTN-B/taxas', { 
  waitUntil: 'networkidle', 
  timeout: 45000 
});
await page.waitForTimeout(4000);

// Tentar obter o token do localStorage/sessionStorage
const tokenFromStorage = await page.evaluate(() => {
  // Procurar token Firebase no localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key);
    if (val && val.includes('eyJ')) return { key, val: val.substring(0, 200) };
  }
  // Tentar sessionStorage
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    const val = sessionStorage.getItem(key);
    if (val && val.includes('eyJ')) return { key, val: val.substring(0, 200) };
  }
  return null;
});

console.log('Token from storage:', tokenFromStorage);

// Executar chamada de API diretamente no contexto da página
const apiData = await page.evaluate(async () => {
  const BASE = 'https://data-api.prd.anbima.com.br/web-bff/v1';
  
  // Pegar o token do Firebase do IndexedDB
  const getToken = () => new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('firebaseLocalStorage', 'readonly');
      const store = tx.objectStore('firebaseLocalStorage');
      const getAll = store.getAll();
      getAll.onsuccess = () => {
        const items = getAll.result;
        for (const item of items) {
          if (item.value?.stsTokenManager?.accessToken) {
            resolve(item.value.stsTokenManager.accessToken);
            return;
          }
        }
        resolve(null);
      };
    };
    req.onerror = () => resolve(null);
  });
  
  const token = await getToken();
  if (!token) return { error: 'no token found', token: null };
  
  // Testar endpoint de NTN-B taxas
  try {
    const r = await fetch(`${BASE}/titulos-publicos/NTN-B/taxas`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.text();
    return { 
      token: token.substring(0, 50) + '...', 
      status: r.status, 
      data: data.substring(0, 500) 
    };
  } catch(e) {
    return { error: e.message, token: token.substring(0, 50) };
  }
});

console.log('\n=== API Data from page context ===');
console.log(JSON.stringify(apiData, null, 2));

console.log('\n=== Intercepted API Results ===');
for (const [url, data] of Object.entries(apiResults)) {
  console.log(`\nURL: ${url}`);
  console.log(`Status: ${data.status}`);
  console.log(`Data: ${data.data}`);
}

await browser.close();
