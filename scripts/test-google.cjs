const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();

  try {
    await page.goto('https://www.google.com/search?q=CRI+financiamento+terreno+emissao+brasil&hl=pt-BR&num=10', {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await page.waitForTimeout(2000);

    const debug = await page.evaluate(() => {
      const title = document.title;
      // Tentar vários seletores
      const sel1 = document.querySelectorAll('div.g a[href]').length;
      const sel2 = document.querySelectorAll('a[jsname]').length;
      const sel3 = document.querySelectorAll('h3').length;
      const sel4 = document.querySelectorAll('[data-ved] a').length;

      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => {
          const h = a.href || '';
          return h.startsWith('http') && !h.includes('google.com') && !h.includes('googleapis.com') && !h.includes('gstatic.com');
        })
        .slice(0, 10)
        .map(a => ({ text: a.textContent.trim().slice(0, 60), url: a.href.slice(0, 120) }));

      return { title, sel1, sel2, sel3, sel4, links, bodyLen: document.body.innerText.length };
    });

    console.log('Title:', debug.title);
    console.log('Body length:', debug.bodyLen);
    console.log('Seletores: div.g a=', debug.sel1, 'a[jsname]=', debug.sel2, 'h3=', debug.sel3, '[data-ved]=', debug.sel4);
    console.log('Links:', JSON.stringify(debug.links, null, 2));
  } catch (e) {
    console.log('Erro:', e.message);
  }
  await browser.close();
})();
