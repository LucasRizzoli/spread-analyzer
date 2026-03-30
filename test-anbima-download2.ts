/**
 * Script de teste v2: Interceptar requisição de download ao clicar no botão
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const DOWNLOAD_DIR = "/home/ubuntu/Downloads/anbima-test";

async function testAnbimaDownload() {
  console.log("[Test] Iniciando teste v2...");
  
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
    const initPage = await context.newPage();
    await initPage.goto("https://data.anbima.com.br", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await initPage.waitForTimeout(2000);
    await initPage.close();

    // Navegar para a página do dataset
    const page = await context.newPage();
    
    // Capturar TODAS as requisições de rede
    const allRequests: Array<{method: string, url: string, postData?: string}> = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("anbima")) {
        allRequests.push({
          method: request.method(),
          url,
          postData: request.postData() || undefined,
        });
      }
    });

    const allResponses: Array<{status: number, url: string}> = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("anbima")) {
        allResponses.push({ status: response.status(), url });
      }
    });

    await page.goto(
      "https://data.anbima.com.br/datasets/data-debentures-precificacao-anbima",
      { waitUntil: "networkidle", timeout: 30000 }
    );
    await page.waitForTimeout(3000);

    // Encontrar e clicar no botão Download
    const buttons = await page.locator('button').all();
    let downloadButton = null;
    
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text?.trim() === "Download") {
        downloadButton = btn;
        console.log("[Test] Botão Download encontrado!");
        break;
      }
    }

    if (!downloadButton) {
      console.log("[Test] ❌ Botão Download não encontrado");
      return;
    }

    // Limpar requests anteriores para ver apenas as do clique
    allRequests.length = 0;
    allResponses.length = 0;

    // Tentar capturar download
    console.log("[Test] Clicando no botão Download...");
    
    let downloadSuccess = false;
    
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
      await downloadButton.click();
      
      const download = await downloadPromise;
      const filename = download.suggestedFilename() || "anbima-download.xls";
      const savePath = path.join(DOWNLOAD_DIR, filename);
      await download.saveAs(savePath);
      
      const stats = fs.statSync(savePath);
      console.log(`[Test] ✅ Download via evento: ${savePath} (${(stats.size / 1024).toFixed(1)} KB)`);
      downloadSuccess = true;
      
    } catch (err) {
      console.log(`[Test] Download via evento falhou: ${err}`);
    }

    // Aguardar requisições de rede
    await page.waitForTimeout(3000);

    console.log("\n[Test] Requisições capturadas após clique:");
    allRequests.forEach(r => {
      console.log(`  ${r.method} ${r.url}`);
      if (r.postData) console.log(`    Body: ${r.postData.substring(0, 200)}`);
    });

    console.log("\n[Test] Respostas capturadas após clique:");
    allResponses.forEach(r => {
      console.log(`  ${r.status} ${r.url}`);
    });

    // Verificar se há endpoint de export/download na API
    const exportRequests = allRequests.filter(r => 
      r.url.includes("export") || r.url.includes("download") || r.url.includes("xlsx") || r.url.includes("xls")
    );
    
    if (exportRequests.length > 0) {
      console.log("\n[Test] ✅ Endpoints de export encontrados:");
      exportRequests.forEach(r => console.log(`  ${r.method} ${r.url}`));
    }

    // Tentar fazer a chamada direta para o endpoint de dados
    console.log("\n[Test] Testando API direta de dados...");
    
    // Pegar os cookies da sessão
    const cookies = await context.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    
    // Tentar chamar o endpoint de export diretamente
    const exportUrl = "https://data-api.prd.anbima.com.br/web-bff/v2/datasets/data-debentures-precificacao-anbima/export";
    
    const exportResponse = await page.evaluate(async (url: string) => {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*",
          },
        });
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
          url: response.url,
        };
      } catch (err) {
        return { error: String(err) };
      }
    }, exportUrl);
    
    console.log(`[Test] Resposta do endpoint export: ${JSON.stringify(exportResponse)}`);

    // Tentar com POST
    const postExportResponse = await page.evaluate(async (url: string) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "*/*",
          },
          body: JSON.stringify({}),
        });
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
          url: response.url,
        };
      } catch (err) {
        return { error: String(err) };
      }
    }, exportUrl);
    
    console.log(`[Test] Resposta POST do endpoint export: ${JSON.stringify(postExportResponse)}`);

    await page.close();
    await context.close();

    if (!downloadSuccess) {
      console.log("\n[Test] ⚠️ Download automático requer investigação adicional");
    }

  } finally {
    await browser.close();
  }
}

testAnbimaDownload().catch(console.error);
