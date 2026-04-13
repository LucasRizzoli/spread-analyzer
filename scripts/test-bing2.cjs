const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();

  await page.goto('https://www.bing.com/search?q=CRI+financiamento+terreno+emissao+brasil&cc=br&setlang=pt-BR', {
    waitUntil: 'networkidle', timeout: 20000
  });
  await page.waitForTimeout(3000);

  const debug = await page.evaluate(() => {
    // Ver o título da página e alguns seletores
    const title = document.title;
    const allLinks = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => a.href.startsWith('http') && !a.href.includes('bing.com') && !a.href.includes('microsoft.com'))
      .slice(0, 10)
      .map(a => ({ text: a.textContent.trim().slice(0, 60), url: a.href.slice(0, 100) }));
    return { title, allLinks, bodySnippet: document.body.innerText.slice(0, 500) };
  });

  console.log('Title:', debug.title);
  console.log('Body snippet:', debug.bodySnippet.slice(0, 200));
  console.log('Links encontrados:', JSON.stringify(debug.allLinks, null, 2));
  await browser.close();
})();
