import { JSDOM } from 'jsdom';

async function testDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
  });
  const html = await res.text();
  const dom = new JSDOM(html);
  const links = [];
  dom.window.document.querySelectorAll('a.result__a').forEach(a => {
    const href = a.href;
    if (href && href.startsWith('http') && !href.includes('duckduckgo')) {
      links.push({ title: a.textContent.trim(), url: href });
    }
  });
  return links.slice(0, 5);
}

async function testBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=br&setlang=pt-BR`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
  });
  const html = await res.text();
  const dom = new JSDOM(html);
  const links = [];
  dom.window.document.querySelectorAll('li.b_algo h2 a').forEach(a => {
    const href = a.href;
    if (href && href.startsWith('http') && !href.includes('bing.com') && !href.includes('microsoft.com')) {
      links.push({ title: a.textContent.trim(), url: href });
    }
  });
  return links.slice(0, 5);
}

const query = 'CRI financiamento terreno emissão Brasil';
console.log('=== DuckDuckGo ===');
const ddg = await testDDG(query);
console.log(JSON.stringify(ddg, null, 2));

console.log('\n=== Bing ===');
const bing = await testBing(query);
console.log(JSON.stringify(bing, null, 2));
