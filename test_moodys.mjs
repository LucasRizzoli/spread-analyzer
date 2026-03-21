import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  });

  console.log('Navegando para moodyslocal.com.br...');
  await page.goto('https://moodyslocal.com.br', { waitUntil: 'networkidle', timeout: 40000 });
  
  // Aguardar Cloudflare resolver
  await page.waitForTimeout(6000);
  
  const title = await page.title();
  console.log('Title:', title);
  
  const content = await page.content();
  
  // Buscar link xlsx
  const match = content.match(/https:\/\/[^\s"'<>]*MOODYS_LOCAL[^\s"'<>]*\.xlsx/i) ||
                content.match(/https:\/\/moodyslocal\.com\.br\/wp-content\/uploads\/[^\s"'<>]*\.xlsx/i);
  
  if (match) {
    console.log('XLSX URL encontrada:', match[0]);
  } else {
    console.log('XLSX URL: NOT FOUND');
    
    // Tentar via seletor
    const links = await page.$$eval('a', els => els.map(e => e.href).filter(h => h.includes('.xlsx')));
    console.log('Links xlsx via DOM:', JSON.stringify(links));
    
    // Verificar se ainda está no Cloudflare
    const cfChallenge = content.includes('Just a moment') || content.includes('challenge-platform');
    console.log('Ainda no Cloudflare challenge:', cfChallenge);
    
    if (cfChallenge) {
      console.log('Aguardando mais 10s para Cloudflare resolver...');
      await page.waitForTimeout(10000);
      const title2 = await page.title();
      console.log('Title após espera:', title2);
      const links2 = await page.$$eval('a', els => els.map(e => e.href).filter(h => h.includes('.xlsx')));
      console.log('Links xlsx após espera:', JSON.stringify(links2));
    }
  }
  
  await browser.close();
})().catch(e => console.error('ERROR:', e.message, e.stack));
