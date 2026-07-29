import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATA_REFRESH_INTERVAL_MS,
  formatDatasetUpdatedAt,
  watchForDatasetUpdates
} from '../src/data-refresh.js';

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
    listenerCount() {
      return listeners.size;
    }
  };
};

test('dataset refreshes resume for visible, long-lived dashboard tabs', () => {
  const windowTarget = createEventTarget();
  const documentTarget = {
    ...createEventTarget(),
    visibilityState: 'visible'
  };
  let intervalCallback;
  let intervalDelay;
  let clearedInterval;
  let refreshCount = 0;

  const stopWatching = watchForDatasetUpdates(
    () => {
      refreshCount += 1;
    },
    {
      windowTarget,
      documentTarget,
      setIntervalFn(callback, delay) {
        intervalCallback = callback;
        intervalDelay = delay;
        return 42;
      },
      clearIntervalFn(intervalId) {
        clearedInterval = intervalId;
      }
    }
  );

  assert.equal(intervalDelay, DATA_REFRESH_INTERVAL_MS);

  windowTarget.dispatch('focus');
  assert.equal(refreshCount, 1);

  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatch('visibilitychange');
  intervalCallback();
  assert.equal(refreshCount, 1);

  documentTarget.visibilityState = 'visible';
  documentTarget.dispatch('visibilitychange');
  intervalCallback();
  assert.equal(refreshCount, 3);

  stopWatching();
  assert.equal(windowTarget.listenerCount(), 0);
  assert.equal(documentTarget.listenerCount(), 0);
  assert.equal(clearedInterval, 42);
});

test('dataset refresh timestamps include the local date, time, and timezone', () => {
  assert.equal(
    formatDatasetUpdatedAt('2026-07-29T21:58:39Z', {
      timeZone: 'America/Chicago'
    }),
    'July 29, 2026 at 4:58 PM CDT'
  );
  assert.equal(formatDatasetUpdatedAt('not-a-date'), '');
});
