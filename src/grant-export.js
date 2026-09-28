// Summarize the awards in one dashboard grant group for the detailed CSV.
// Keep every distinct metadata value instead of choosing an arbitrary year.
export const summarizeGrantAwards = (awards) => {
  const distinctValues = (key) => [...new Set(awards.map((award) => award[key]).filter(Boolean))];
  const amounts = awards.map((award) => award.amount).filter(Number.isFinite);
  const startDates = distinctValues('startDate').sort();
  const endDates = distinctValues('endDate').sort();

  return {
    ids: distinctValues('id'),
    roles: distinctValues('role'),
    amount: amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null,
    startDate: startDates[0] || '',
    endDate: endDates.at(-1) || '',
    fiscalYears: [...new Set(awards.map((award) => award.fiscalYear).filter(Number.isFinite))]
      .sort((a, b) => a - b),
    titles: distinctValues('title'),
    urls: distinctValues('url')
  };
};
