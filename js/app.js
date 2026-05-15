import { calculateLoan, formatMoney, formatPercent } from "./calculator.js";
import {
  exportResultWorkbook,
  getSheetNames,
  parseRate,
  parseWorkbook,
  readWorkbookFromArrayBuffer,
  summarizeResult,
} from "./excel.js";
import { formatDate, parseDateValue } from "./date-utils.js";

const state = {
  workbook: null,
  input: null,
  result: null,
};

const els = {
  fileInput: document.querySelector("#excelFile"),
  sheetSelect: document.querySelector("#sheetSelect"),
  calculateBtn: document.querySelector("#calculateBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  addRepaymentBtn: document.querySelector("#addRepaymentBtn"),
  status: document.querySelector("#status"),
  warnings: document.querySelector("#warnings"),
  loanDate: document.querySelector("#loanDate"),
  principal: document.querySelector("#principal"),
  annualRate: document.querySelector("#annualRate"),
  interestMode: document.querySelector("#interestMode"),
  interestDay: document.querySelector("#interestDay"),
  lastPaidDate: document.querySelector("#lastPaidDate"),
  endDate: document.querySelector("#endDate"),
  dayCountBasis: document.querySelector("#dayCountBasis"),
  repaymentBody: document.querySelector("#repaymentBody"),
  summaryGrid: document.querySelector("#summaryGrid"),
  monthlyPreview: document.querySelector("#monthlyPreview"),
  quarterlyPreview: document.querySelector("#quarterlyPreview"),
};

els.fileInput.addEventListener("change", handleFileChange);
els.sheetSelect.addEventListener("change", () => loadSelectedSheet());
els.calculateBtn.addEventListener("click", handleCalculate);
els.exportBtn.addEventListener("click", handleExport);
els.addRepaymentBtn.addEventListener("click", () => addRepaymentRow());

setStatus("请选择标准导入示例 Excel 或原始示例 Excel。");

async function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    state.workbook = readWorkbookFromArrayBuffer(buffer);
    fillSheetOptions(getSheetNames(state.workbook));
    loadSelectedSheet();
  } catch (error) {
    showError(error);
  }
}

function fillSheetOptions(sheetNames) {
  els.sheetSelect.innerHTML = "";
  for (const sheetName of sheetNames) {
    const option = document.createElement("option");
    option.value = sheetName;
    option.textContent = sheetName;
    els.sheetSelect.appendChild(option);
  }

  const preferred = sheetNames.find((name) => name.includes("输入模板")) || sheetNames.find((name) => /^示例/.test(name));
  if (preferred) els.sheetSelect.value = preferred;
}

function loadSelectedSheet() {
  try {
    state.input = parseWorkbook(state.workbook, els.sheetSelect.value);
    renderInput(state.input);
    calculateAndRender();
    setStatus(`已读取 ${state.input.sourceSheetName}。`);
  } catch (error) {
    showError(error);
  }
}

function renderInput(input) {
  els.loanDate.value = formatDate(input.loanDate);
  els.principal.value = input.principal || "";
  els.annualRate.value = formatPercent(input.annualRate);
  els.interestMode.value = input.interestMode;
  els.interestDay.value = input.interestDay || 21;
  els.lastPaidDate.value = formatDate(input.lastPaidDate);
  els.endDate.value = input.endDate ? formatDate(input.endDate) : "";
  els.dayCountBasis.value = input.dayCountBasis || 360;

  els.repaymentBody.innerHTML = "";
  input.repayments.forEach((repayment, index) => addRepaymentRow(repayment, index + 1));
}

function addRepaymentRow(repayment = {}, index = null) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td class="row-index">${index || els.repaymentBody.children.length + 1}</td>
    <td><input type="date" class="repayment-date" value="${formatDate(repayment.date)}"></td>
    <td><input type="number" class="repayment-amount" value="${repayment.amount ?? ""}" min="0" step="0.01"></td>
    <td><input type="number" class="repayment-remaining" value="${repayment.remainingPrincipal ?? ""}" min="0" step="0.01"></td>
    <td><button class="icon-button remove-row" type="button" title="删除">×</button></td>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => {
    row.remove();
    refreshRepaymentIndexes();
  });
  els.repaymentBody.appendChild(row);
}

function refreshRepaymentIndexes() {
  [...els.repaymentBody.querySelectorAll(".row-index")].forEach((cell, index) => {
    cell.textContent = String(index + 1);
  });
}

function handleCalculate() {
  try {
    calculateAndRender();
    setStatus("已重新计算。");
  } catch (error) {
    showError(error);
  }
}

function calculateAndRender() {
  state.input = collectInput();
  state.result = calculateLoan(state.input);
  renderSummary(state.result);
  renderWarnings(state.result.warnings);
  renderPreviewTable(els.monthlyPreview, state.result.monthly.rows.slice(0, 12));
  renderPreviewTable(els.quarterlyPreview, state.result.quarterly.rows.slice(0, 12));
  els.exportBtn.disabled = false;
}

function collectInput() {
  const repayments = [...els.repaymentBody.querySelectorAll("tr")]
    .map((row) => ({
      date: parseDateValue(row.querySelector(".repayment-date").value),
      amount: Number(row.querySelector(".repayment-amount").value || 0),
      remainingPrincipal: row.querySelector(".repayment-remaining").value === ""
        ? null
        : Number(row.querySelector(".repayment-remaining").value),
    }))
    .filter((item) => item.date && item.amount > 0);

  return {
    sourceSheetName: state.input?.sourceSheetName || "",
    loanDate: parseDateValue(els.loanDate.value),
    principal: Number(els.principal.value || 0),
    annualRate: parseRate(els.annualRate.value),
    interestMode: els.interestMode.value,
    interestDay: Number(els.interestDay.value || 21),
    lastPaidDate: parseDateValue(els.lastPaidDate.value),
    endDate: parseDateValue(els.endDate.value),
    dayCountBasis: Number(els.dayCountBasis.value || 360),
    repayments,
  };
}

function renderSummary(result) {
  const summary = summarizeResult(result);
  els.summaryGrid.innerHTML = "";

  const cards = [
    ["计息方式", summary.selectedMode],
    ["结果行数", summary.rows],
    ["第一期", `${summary.firstDate} / ${summary.firstInterest}`],
    ["最后一期", summary.lastDate],
    ["利息合计", summary.totalInterestText],
    ["贷款金额", formatMoney(result.input.principal)],
  ];

  for (const [label, value] of cards) {
    const card = document.createElement("div");
    card.className = "metric";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.summaryGrid.appendChild(card);
  }
}

function renderWarnings(warnings) {
  els.warnings.innerHTML = "";
  if (!warnings.length) {
    els.warnings.hidden = true;
    return;
  }

  els.warnings.hidden = false;
  warnings.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    els.warnings.appendChild(item);
  });
}

function renderPreviewTable(target, rows) {
  target.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(row.dueDate)}</td>
      <td>${formatMoney(row.interest)}</td>
      <td>${formatMoney(row.closingPrincipal)}</td>
    `;
    target.appendChild(tr);
  }
}

function handleExport() {
  try {
    if (!state.result) calculateAndRender();
    const source = state.input?.sourceSheetName ? `_${state.input.sourceSheetName}` : "";
    exportResultWorkbook(state.result, `利息计算结果${source}.xlsx`);
    setStatus("已导出 Excel。");
  } catch (error) {
    showError(error);
  }
}

function setStatus(message) {
  els.status.textContent = message;
  els.status.className = "status";
}

function showError(error) {
  console.error(error);
  els.status.textContent = error.message || String(error);
  els.status.className = "status error";
}
