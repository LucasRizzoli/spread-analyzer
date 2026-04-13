const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();

  await page.goto('https://www.bing.com/search?q=CRI+financiamento+terreno+emissao+brasil&cc=br&setlang=pt-BR', {
    waitUntil: 'domcontentloaded', timeout: 20000
  });
  await page.waitForTimeout(2000);

  const links = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('li.b_algo h2 a').forEach(a => {
      if (a.href && a.href.startsWith('http') && !a.href.includes('bing.com')) {
        results.push({ title: a.textContent.trim().slice(0, 80), url: a.href });
      }
    });
    return results.slice(0, 8);
  });

  console.log('Bing links:', JSON.stringify(links, null, 2));
  await browser.close();
})();
