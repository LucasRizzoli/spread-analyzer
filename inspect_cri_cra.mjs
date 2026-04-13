import ExcelJS from "exceljs";
import { readFileSync } from "fs";

const buffer = readFileSync("/tmp/cri_cra_sample.xls");
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);

const ws = wb.worksheets[0];
console.log("Worksheet:", ws.name, "rowCount:", ws.rowCount);

// Mostrar as primeiras 8 linhas com todos os valores
let count = 0;
ws.eachRow((row, rowNumber) => {
  if (count >= 8) return;
  const vals = row.values;
  // Mostrar índices 0-20
  const arr = [];
  for (let i = 1; i <= 20; i++) {
    arr.push(`[${i-1}]=${JSON.stringify(vals[i])}`);
  }
  console.log(`Row ${rowNumber}:`, arr.join(" | "));
  count++;
});
