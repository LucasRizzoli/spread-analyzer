/**
 * Script de teste: Download automático da planilha ANBIMA Data via Playwright
 * 
 * Testa se é possível:
 * 1. Navegar até data.anbima.com.br/datasets/data-debentures-precificacao-anbima
 * 2. Clicar no botão "Download"
 * 3. Capturar o arquivo XLS baixado
 * 
 * Execução: npx tsx /home/ubuntu/test-anbima-download.ts
 */

import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const DOWNLOAD_DIR = "/home/ubuntu/Downloads/anbima-test";

async function testAnbimaDownload() {
  console.log("[Test] Iniciando teste de download automático ANBIMA Data...");
  
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
    });

    // Inicializar sessão
    console.log("[Test] Inicializando sessão no ANBIMA Data...");
    const initPage = await context.newPage();
    await initPage.goto("https://data.anbima.com.br", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await initPage.waitForTimeout(2000);
    await initPage.close();

    // Navegar para a página do dataset de debêntures
    console.log("[Test] Navegando para dataset de Debêntures...");
    const page = await context.newPage();
    
    await page.goto(
      "https://data.anbima.com.br/datasets/data-debentures-precificacao-anbima",
      { waitUntil: "networkidle", timeout: 30000 }
    );
    await page.waitForTimeout(3000);

    // Verificar se chegou na página correta
    const title = await page.title();
    console.log(`[Test] Título da página: ${title}`);

    // Procurar o botão de Download
    const downloadButton = page.locator('button[hint="Baixar amostra de dados"]');
    const downloadButtonCount = await downloadButton.count();
    console.log(`[Test] Botões de download encontrados: ${downloadButtonCount}`);

    if (downloadButtonCount === 0) {
      // Tentar alternativa
      const allButtons = await page.locator('button').all();
      console.log(`[Test] Total de botões na página: ${allButtons.length}`);
      for (const btn of allButtons) {
        const text = await btn.textContent();
        const hint = await btn.getAttribute('hint');
        if (text?.toLowerCase().includes('download') || hint?.toLowerCase().includes('download')) {
          console.log(`[Test] Botão encontrado: text="${text}", hint="${hint}"`);
        }
      }
    }

    // Tentar interceptar a requisição de download via API
    console.log("[Test] Monitorando requisições de rede para encontrar URL de download...");
    
    const downloadUrls: string[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("anbima") && 
        (url.includes("download") || url.includes("export") || url.includes(".xls") || url.includes(".xlsx"))
      ) {
        console.log(`[Test] URL de download detectada: ${url}`);
        downloadUrls.push(url);
      }
    });

    // Tentar clicar no botão Download
    if (downloadButtonCount > 0) {
      console.log("[Test] Clicando no botão Download...");
      
      // Aguardar o download
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      
      try {
        await downloadButton.click();
        const download = await downloadPromise;
        
        const suggestedFilename = download.suggestedFilename();
        const savePath = path.join(DOWNLOAD_DIR, suggestedFilename || "anbima-debentures.xls");
        
        await download.saveAs(savePath);
        console.log(`[Test] ✅ Download concluído: ${savePath}`);
        
        const stats = fs.statSync(savePath);
        console.log(`[Test] Tamanho do arquivo: ${(stats.size / 1024).toFixed(1)} KB`);
        
      } catch (err) {
        console.log(`[Test] ⚠️ Download via evento falhou: ${err}`);
        console.log("[Test] Tentando via interceptação de rede...");
      }
    }

    // Verificar se há API direta para download
    console.log("\n[Test] Verificando APIs disponíveis via DevTools...");
    
    // Interceptar todas as chamadas de API
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("data-api.prd.anbima.com.br") || url.includes("anbima.com.br/api")) {
        apiCalls.push(`${request.method()} ${url}`);
      }
    });

    // Recarregar para capturar todas as chamadas
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    if (apiCalls.length > 0) {
      console.log("[Test] APIs detectadas:");
      apiCalls.forEach(url => console.log(`  ${url}`));
    }

    // Tentar encontrar a URL de download via JavaScript
    const downloadUrl = await page.evaluate(() => {
      // Procurar por links de download na página
      const links = Array.from(document.querySelectorAll('a[href*="download"], a[href*=".xls"], a[href*=".xlsx"]'));
      return links.map(l => (l as HTMLAnchorElement).href);
    });
    
    if (downloadUrl.length > 0) {
      console.log("[Test] Links de download encontrados no DOM:");
      downloadUrl.forEach(url => console.log(`  ${url}`));
    }

    await page.close();
    await context.close();

    console.log("\n[Test] Resumo:");
    console.log(`  URLs de download capturadas: ${downloadUrls.length}`);
    console.log(`  Links no DOM: ${downloadUrl.length}`);
    
    if (downloadUrls.length > 0 || downloadUrl.length > 0) {
      console.log("[Test] ✅ Download automático é POSSÍVEL");
    } else {
      console.log("[Test] ⚠️ Não foi possível encontrar URL de download direta");
      console.log("[Test] Pode ser necessário autenticação ou o download usa JavaScript dinâmico");
    }

  } finally {
    await browser.close();
  }
}

testAnbimaDownload().catch(console.error);
