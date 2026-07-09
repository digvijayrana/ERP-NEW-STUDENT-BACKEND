function toYearMonth(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodFromParts(year, month) {
  return year * 100 + month;
}

function periodFromDate(date) {
  const d = new Date(date);
  return periodFromParts(d.getFullYear(), d.getMonth() + 1);
}

function monthInService(bus, year, month) {
  if (!bus) return false;

  if (bus.serviceStartDate) {
    const start = new Date(bus.serviceStartDate);
    const startPeriod = periodFromParts(start.getFullYear(), start.getMonth() + 1);
    if (periodFromParts(year, month) < startPeriod) return false;
  } else if (bus.effectiveFrom) {
    const [effYear, effMonth] = bus.effectiveFrom.split('-').map(Number);
    if (Number.isFinite(effYear) && Number.isFinite(effMonth)) {
      if (periodFromParts(year, month) < periodFromParts(effYear, effMonth)) return false;
    }
  }

  if (bus.serviceEndDate) {
    const end = new Date(bus.serviceEndDate);
    const endPeriod = periodFromParts(end.getFullYear(), end.getMonth() + 1);
    if (periodFromParts(year, month) > endPeriod) return false;
  }

  return true;
}

function isPeriodOnOrAfter(year, month, effectiveDate) {
  if (!effectiveDate) return true;
  return periodFromParts(year, month) >= periodFromDate(effectiveDate);
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) return 'End date cannot be before start date';
  return null;
}

module.exports = {
  toYearMonth,
  periodFromParts,
  periodFromDate,
  monthInService,
  isPeriodOnOrAfter,
  validateDateRange
};
