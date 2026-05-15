import {
  addMonths,
  cloneDate,
  compareDates,
  daysBetween,
  formatDate,
  formatDateCompact,
  isQuarterSettlement,
  isSameDate,
  maxDate,
  minDate,
  nextSettlementDate,
} from "./date-utils.js";

export function normalizeLoanInput(input) {
  const repayments = [...(input.repayments || [])]
    .filter((item) => item.date && Number(item.amount) > 0)
    .map((item) => ({
      date: cloneDate(item.date),
      amount: Number(item.amount),
      remainingPrincipal: Number.isFinite(Number(item.remainingPrincipal))
        ? Number(item.remainingPrincipal)
        : null,
      note: item.note || "",
    }))
    .sort((a, b) => compareDates(a.date, b.date));

  return {
    loanDate: input.loanDate,
    principal: Number(input.principal || 0),
    annualRate: Number(input.annualRate || 0),
    interestMode: input.interestMode || "按月计息",
    interestDay: Number(input.interestDay || 21),
    lastPaidDate: input.lastPaidDate || input.loanDate,
    endDate: input.endDate || null,
    dayCountBasis: Number(input.dayCountBasis || 360),
    repayments,
  };
}

export function calculateLoan(input) {
  const normalized = normalizeLoanInput(input);
  validateLoanInput(normalized);

  const monthly = buildMonthlySchedule(normalized);
  const quarterly = buildQuarterlySchedule(normalized);
  const selected = normalized.interestMode.includes("季") ? quarterly : monthly;

  return {
    input: normalized,
    monthly,
    quarterly,
    selected,
    warnings: buildWarnings(normalized),
  };
}

function validateLoanInput(input) {
  if (!input.loanDate) throw new Error("请填写放款日期");
  if (!input.principal || input.principal <= 0) throw new Error("请填写贷款金额");
  if (!input.annualRate || input.annualRate <= 0) throw new Error("请填写年利率");
  if (!input.interestDay || input.interestDay < 1 || input.interestDay > 31) {
    throw new Error("计息日需要填写 1 到 31 之间的数字");
  }
}

function buildMonthlySchedule(input) {
  let periodStart = cloneDate(input.lastPaidDate || input.loanDate);
  let outstanding = principalAt(input.principal, input.repayments, periodStart);
  const rows = [];
  const details = [];

  for (let index = 1; index <= 700 && outstanding > 0.005; index += 1) {
    let dueDate = nextSettlementDate(periodStart, input.interestDay);
    const payoffDate = firstPayoffDate(input.principal, input.repayments, periodStart, dueDate);
    const explicitEndDate = input.endDate && compareDates(input.endDate, dueDate) < 0 ? input.endDate : null;
    dueDate = minDate(payoffDate, explicitEndDate, dueDate);

    const calculation = calculateInterestPeriod({
      periodStart,
      periodEnd: dueDate,
      openingPrincipal: outstanding,
      repayments: input.repayments,
      annualRate: input.annualRate,
      dayCountBasis: input.dayCountBasis,
    });

    rows.push({
      index,
      dueDate,
      dueDateText: formatDateCompact(dueDate),
      interest: roundMoney(calculation.interest),
      openingPrincipal: roundMoney(outstanding),
      closingPrincipal: roundMoney(calculation.closingPrincipal),
      mode: "按月计息",
      isFinal: calculation.closingPrincipal <= 0.005,
    });

    details.push(...toDetailRows("按月计息", index, dueDate, calculation.segments));

    outstanding = calculation.closingPrincipal;
    periodStart = dueDate;

    if (input.endDate && compareDates(periodStart, input.endDate) >= 0) break;
  }

  return { rows, details };
}

function buildQuarterlySchedule(input) {
  let rowStart = cloneDate(input.lastPaidDate || input.loanDate);
  let quarterStart = cloneDate(rowStart);
  let quarterOpeningPrincipal = principalAt(input.principal, input.repayments, quarterStart);
  const rows = [];
  const details = [];

  for (let index = 1; index <= 700 && quarterOpeningPrincipal > 0.005; index += 1) {
    let dueDate = nextSettlementDate(rowStart, input.interestDay);
    const payoffDate = firstPayoffDate(input.principal, input.repayments, quarterStart, dueDate);
    const explicitEndDate = input.endDate && compareDates(input.endDate, dueDate) < 0 ? input.endDate : null;
    dueDate = minDate(payoffDate, explicitEndDate, dueDate);

    const shouldSettle =
      isQuarterSettlement(dueDate) ||
      Boolean(payoffDate && isSameDate(payoffDate, dueDate)) ||
      Boolean(explicitEndDate && isSameDate(explicitEndDate, dueDate));

    let interest = 0;
    let closingPrincipal = quarterOpeningPrincipal;
    let isFinal = false;

    if (shouldSettle) {
      const calculation = calculateInterestPeriod({
        periodStart: quarterStart,
        periodEnd: dueDate,
        openingPrincipal: quarterOpeningPrincipal,
        repayments: input.repayments,
        annualRate: input.annualRate,
        dayCountBasis: input.dayCountBasis,
      });

      interest = roundMoney(calculation.interest);
      closingPrincipal = calculation.closingPrincipal;
      isFinal = closingPrincipal <= 0.005;
      details.push(...toDetailRows("按季计息", index, dueDate, calculation.segments));
      quarterStart = dueDate;
      quarterOpeningPrincipal = closingPrincipal;
    }

    rows.push({
      index,
      dueDate,
      dueDateText: formatDateCompact(dueDate),
      interest,
      openingPrincipal: roundMoney(quarterOpeningPrincipal),
      closingPrincipal: roundMoney(closingPrincipal),
      mode: "按季计息",
      isFinal,
      settled: shouldSettle,
    });

    rowStart = dueDate;

    if (input.endDate && compareDates(rowStart, input.endDate) >= 0) break;
    if (isFinal) break;
  }

  return { rows, details };
}

function calculateInterestPeriod({
  periodStart,
  periodEnd,
  openingPrincipal,
  repayments,
  annualRate,
  dayCountBasis,
}) {
  let cursor = cloneDate(periodStart);
  let principal = Number(openingPrincipal);
  let interest = 0;
  const segments = [];

  const periodRepayments = repayments.filter(
    (item) => compareDates(item.date, periodStart) > 0 && compareDates(item.date, periodEnd) <= 0,
  );

  for (const repayment of periodRepayments) {
    const days = daysBetween(cursor, repayment.date);
    if (days > 0 && principal > 0) {
      const segmentInterest = principal * annualRate / dayCountBasis * days;
      segments.push(buildSegment(cursor, repayment.date, days, principal, annualRate, segmentInterest, repayment.amount));
      interest += segmentInterest;
    }

    principal = Math.max(0, principal - repayment.amount);
    cursor = cloneDate(repayment.date);
  }

  const remainingDays = daysBetween(cursor, periodEnd);
  if (remainingDays > 0 && principal > 0) {
    const segmentInterest = principal * annualRate / dayCountBasis * remainingDays;
    segments.push(buildSegment(cursor, periodEnd, remainingDays, principal, annualRate, segmentInterest, 0));
    interest += segmentInterest;
  }

  return {
    interest,
    closingPrincipal: Math.max(0, principal),
    segments,
  };
}

function buildSegment(startDate, endDate, days, principal, annualRate, interest, repaymentAmount) {
  return {
    startDate,
    endDate,
    days,
    principal: roundMoney(principal),
    annualRate,
    interest: roundMoney(interest),
    repaymentAmount: roundMoney(repaymentAmount),
  };
}

function toDetailRows(mode, periodIndex, dueDate, segments) {
  return segments.map((segment) => ({
    mode,
    periodIndex,
    dueDate,
    dueDateText: formatDate(dueDate),
    startDate: segment.startDate,
    startDateText: formatDate(segment.startDate),
    endDate: segment.endDate,
    endDateText: formatDate(segment.endDate),
    days: segment.days,
    principal: segment.principal,
    annualRate: segment.annualRate,
    interest: segment.interest,
    repaymentAmount: segment.repaymentAmount,
  }));
}

function principalAt(principal, repayments, date) {
  return Math.max(
    0,
    repayments
      .filter((item) => compareDates(item.date, date) <= 0)
      .reduce((current, item) => current - Number(item.amount || 0), Number(principal || 0)),
  );
}

function firstPayoffDate(principal, repayments, afterDate, beforeOrOnDate) {
  let remaining = principalAt(principal, repayments, afterDate);
  for (const repayment of repayments) {
    if (compareDates(repayment.date, afterDate) <= 0) continue;
    if (compareDates(repayment.date, beforeOrOnDate) > 0) break;

    remaining -= repayment.amount;
    if (remaining <= 0.005) return repayment.date;
  }
  return null;
}

function buildWarnings(input) {
  const warnings = [];
  const totalRepayment = input.repayments.reduce((sum, item) => sum + item.amount, 0);

  if (totalRepayment < input.principal) {
    warnings.push("还款计划本金合计小于贷款金额，计算会在最后一条还款后继续保留剩余本金。");
  }

  let remaining = input.principal;
  for (const repayment of input.repayments) {
    remaining = roundMoney(remaining - repayment.amount);
    if (
      repayment.remainingPrincipal !== null &&
      Math.abs(repayment.remainingPrincipal - Math.max(remaining, 0)) > 0.01
    ) {
      warnings.push(
        `${formatDate(repayment.date)} 的“剩余本金”与按还款本金推算结果不一致，表内为 ${formatMoney(repayment.remainingPrincipal)}，推算为 ${formatMoney(Math.max(remaining, 0))}。`,
      );
      break;
    }
  }

  return warnings;
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
