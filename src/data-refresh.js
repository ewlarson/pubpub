export const DATA_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export const formatDatasetUpdatedAt = (
  value,
  { locale = 'en-US', timeZone } = {}
) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return '';
  }

  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  };
  if (timeZone) {
    options.timeZone = timeZone;
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
};

export const watchForDatasetUpdates = (
  refresh,
  {
    windowTarget = window,
    documentTarget = document,
    intervalMs = DATA_REFRESH_INTERVAL_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = {}
) => {
  const refreshIfVisible = () => {
    if (documentTarget.visibilityState !== 'hidden') {
      refresh();
    }
  };

  windowTarget.addEventListener('focus', refreshIfVisible);
  documentTarget.addEventListener('visibilitychange', refreshIfVisible);
  const intervalId = setIntervalFn(refreshIfVisible, intervalMs);

  return () => {
    windowTarget.removeEventListener('focus', refreshIfVisible);
    documentTarget.removeEventListener('visibilitychange', refreshIfVisible);
    clearIntervalFn(intervalId);
  };
};
