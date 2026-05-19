import {
  formatDate,
  formatDateCompact,
  inferInterestDay,
  parseDateFromText,
  parseDateValue,
} from "./date-utils.js";
import { calculateLoan, formatMoney } from "./calculator.js";

export function readWorkbookFromArrayBuffer(buffer) {
  return getXLSX().read(buffer, { type: "array", cellDates: true });
}

export function getSheetNames(workbook) {
  return workbook.SheetNames || [];
}

export function parseWorkbook(workbook, preferredSheetName = "") {
  const sheetName = chooseSheetName(workbook, preferredSheetName);
  const rows = sheetRows(workbook.Sheets[sheetName]);
  const parser = isStandardTemplate(rows) ? parseStandardTemplate : parseLegacySample;
  const input = parser(rows, sheetName);
  input.sourceSheetName = sheetName;
  return input;
}

export function exportResultWorkbook(result, filename = "利息计算结果.xlsx") {
  const workbook = buildResultWorkbook(result);
  getXLSX().writeFile(workbook, filename);
}

export function buildResultWorkbook(result) {
  const XLSX = getXLSX();
  const workbook = XLSX.utils.book_new();

  const exportSheet = XLSX.utils.aoa_to_sheet(buildExportRows(result));
  exportSheet["!cols"] = [
    { wch: 13 },
    { wch: 14 },
    { wch: 2 },
    { wch: 2 },
    { wch: 13 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(workbook, exportSheet, "导出");

  return workbook;
}

export function buildExportRows(result) {
  const rows = [
    ["按月计息", "", "", "", "按季计息", ""],
    ["还款日期", "利息金额", "", "", "还款日期", "利息金额"],
  ];
  const monthlyRows = result.monthly.rows;
  const quarterlyRows = result.quarterly.rows;
  const maxLength = Math.max(monthlyRows.length, quarterlyRows.length);

  for (let index = 0; index < maxLength; index += 1) {
    const monthly = monthlyRows[index];
    const quarterly = quarterlyRows[index];
    rows.push([
      monthly ? Number(formatDateCompact(monthly.dueDate)) : "",
      monthly ? monthly.interest : "",
      "",
      "",
      quarterly ? Number(formatDateCompact(quarterly.dueDate)) : "",
      quarterly ? quarterly.interest : "",
    ]);
  }

  return rows;
}

function chooseSheetName(workbook, preferredSheetName) {
  const names = getSheetNames(workbook);
  if (!names.length) throw new Error("Excel 中没有可读取的工作表");
  if (preferredSheetName && names.includes(preferredSheetName)) return preferredSheetName;

  const standard = names.find((name) => name.includes("输入模板"));
  if (standard) return standard;

  const sample = names.find((name) => /^示例/.test(name));
  if (sample) return sample;

  return names[0];
}

function sheetRows(sheet) {
  return getXLSX().utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });
}

function isStandardTemplate(rows) {
  return rows.some((row) => normalizeText(row[0]) === "字段" && normalizeText(row[1]) === "值");
}

function parseStandardTemplate(rows) {
  const fieldMap = new Map();
  let repaymentHeaderRow = -1;

  rows.forEach((row, rowIndex) => {
    const key = normalizeText(row[0]);
    if (key && row[1] !== "") fieldMap.set(key, row[1]);
    if (key === "序号" && normalizeText(row[1]) === "还款日期") repaymentHeaderRow = rowIndex;
  });

  const repayments = parseRepaymentRows(rows.slice(repaymentHeaderRow + 1), {
    dateColumn: 1,
    amountColumn: 2,
    remainingColumn: null,
    noteColumn: 3,
  });

  const deductedDate = parseDateValue(fieldMap.get("已扣利息截止日"));
  const loanDate = parseDateValue(fieldMap.get("放款日期"));

  return {
    loanDate,
    principal: parseAmount(fieldMap.get("贷款金额")),
    annualRate: parseRate(fieldMap.get("年利率")),
    interestMode: normalizeMode(fieldMap.get("计息方式")),
    interestDay: Number(fieldMap.get("计息日")) || inferInterestDay(deductedDate, repayments.map((item) => item.date)),
    lastPaidDate: deductedDate || loanDate,
    endDate: parseDateValue(fieldMap.get("计算截止日")),
    dayCountBasis: Number(fieldMap.get("年计息天数")) || 360,
    repayments,
  };
}

function parseLegacySample(rows, sheetName) {
  const title = rows[0]?.[0] || "";
  const secondRow = rows[1] || [];
  const deductedDates = [];

  for (const row of rows) {
    const deductedDate = parseDateValue(row[6]);
    if (deductedDate) deductedDates.push(deductedDate);
  }

  const repayments = parseRepaymentRows(rows.slice(4), {
    dateColumn: 1,
    amountColumn: 2,
    remainingColumn: 3,
  });

  const loanDate = parseDateFromText(title);
  const lastPaidDate = deductedDates.length ? deductedDates.sort((a, b) => a - b).at(-1) : loanDate;

  return {
    loanDate,
    principal: parseAmountFromLoanTitle(title),
    annualRate: parseRate(secondRow[2]),
    interestMode: normalizeMode(secondRow[0] || sheetName),
    interestDay: inferInterestDay(deductedDates, [lastPaidDate]),
    lastPaidDate,
    endDate: null,
    dayCountBasis: 360,
    repayments,
  };
}

function parseRepaymentRows(rows, columns) {
  const repayments = [];

  for (const row of rows) {
    const date = parseDateValue(row[columns.dateColumn]);
    const amount = parseAmount(row[columns.amountColumn]);
    if (!date || !amount) continue;

    repayments.push({
      date,
      amount,
      remainingPrincipal: columns.remainingColumn === null ? null : parseOptionalAmount(row[columns.remainingColumn]),
      note: columns.noteColumn === undefined ? "" : String(row[columns.noteColumn] || ""),
    });
  }

  return repayments;
}

export function parseAmount(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;

  const text = String(value).replaceAll(",", "").replace(/\s/g, "");
  const number = Number((text.match(/-?\d+(\.\d+)?/) || ["0"])[0]);
  if (!Number.isFinite(number)) return 0;
  if (text.includes("亿")) return number * 100000000;
  if (text.includes("万")) return number * 10000;
  return number;
}

function parseOptionalAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = parseAmount(value);
  return Number.isFinite(amount) ? amount : null;
}

function parseAmountFromLoanTitle(value) {
  const text = String(value || "");
  const match = text.match(/放款\s*([0-9,.]+)\s*(亿|万元|万|元)?/);
  if (!match) return parseAmount(text);
  return parseAmount(`${match[1]}${match[2] || ""}`);
}

export function parseRate(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value > 1 ? value / 100 : value;

  const text = String(value).trim();
  const number = Number((text.match(/-?\d+(\.\d+)?/) || ["0"])[0]);
  if (!Number.isFinite(number)) return 0;
  if (text.includes("%")) return number / 100;
  return number > 1 ? number / 100 : number;
}

export function normalizeMode(value) {
  const text = String(value || "");
  return text.includes("季") ? "按季计息" : "按月计息";
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function getXLSX() {
  if (!globalThis.XLSX) {
    throw new Error("未加载 Excel 读写库，请检查 vendor/xlsx.full.min.js 是否存在");
  }
  return globalThis.XLSX;
}

export function summarizeResult(result) {
  const selectedRows = result.selected.rows;
  const totalInterest = selectedRows.reduce((sum, row) => sum + Number(row.interest || 0), 0);
  const lastRow = selectedRows.at(-1);

  return {
    selectedMode: result.input.interestMode,
    rows: selectedRows.length,
    totalInterest,
    totalInterestText: formatMoney(totalInterest),
    firstDate: selectedRows[0] ? formatDate(selectedRows[0].dueDate) : "",
    firstInterest: selectedRows[0] ? formatMoney(selectedRows[0].interest) : "",
    lastDate: lastRow ? formatDate(lastRow.dueDate) : "",
    monthlyFirstRows: result.monthly.rows.slice(0, 8),
    quarterlyFirstRows: result.quarterly.rows.slice(0, 8),
  };
}
