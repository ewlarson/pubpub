import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const PUBLICATIONS_URL = `${import.meta.env.BASE_URL}data/publications.json`;
const GRANTS_URL = `${import.meta.env.BASE_URL}data/grants.json`;

const normalize = (value) => value.toLowerCase();
const normalizeKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const normalizeSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

const formatCurrency = (value) => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return currencyFormatter.format(value);
};

const formatDate = (value) => {
  if (!value) {
    return '—';
  }
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
};

const extractCoreGrantNumber = (value) => {
  if (!value) {
    return '';
  }
  const base = String(value).split('-')[0];
  const stripped = base.replace(/^[0-9]+/, '');
  return (stripped || base).toUpperCase();
};

const parseGrantCore = (value) => {
  const coreNumber = extractCoreGrantNumber(value);
  if (!coreNumber) {
    return { coreNumber: '', activity: '', institute: '', serial: '' };
  }
  const match = coreNumber.match(/^([A-Z0-9]+?)([A-Z]{2})(\d+)$/);
  if (!match) {
    return { coreNumber, activity: '', institute: '', serial: '' };
  }
  return {
    coreNumber,
    activity: match[1],
    institute: match[2],
    serial: match[3]
  };
};

const getGrantGroupInfo = (grant) => {
  const source = grant.coreProjectNum || grant.id || '';
  const parsed = parseGrantCore(source);
  if (
    ['K99', 'R00'].includes(parsed.activity) &&
    parsed.institute &&
    parsed.serial
  ) {
    const displayNumber = `K99/R00${parsed.institute}${parsed.serial}`;
    return {
      key: displayNumber,
      displayNumber,
      type: 'K99/R00'
    };
  }
  const displayNumber = parsed.coreNumber || extractCoreGrantNumber(source) || 'Unknown';
  return {
    key: displayNumber,
    displayNumber,
    type: parsed.activity || ''
  };
};

const buildYearSeries = (publications, range) => {
  const years = publications
    .map((pub) => pub.year)
    .filter((year) => Number.isFinite(year));
  if (!years.length) {
    return [];
  }
  const minYear = Number.isFinite(range?.min) ? range.min : Math.min(...years);
  const maxYear = Number.isFinite(range?.max) ? range.max : Math.max(...years);
  const counts = new Map();
  years.forEach((year) => {
    if (year < minYear || year > maxYear) {
      return;
    }
    counts.set(year, (counts.get(year) || 0) + 1);
  });
  const series = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    series.push({ year, count: counts.get(year) || 0 });
  }
  return series;
};

const formatSparklineLabel = (series) => {
  if (!series.length) {
    return 'No publication history available.';
  }
  return `Publication counts per year: ${series
    .map((entry) => `${entry.year}: ${entry.count}`)
    .join(', ')}`;
};

const getAuthorCounts = (member, publications) => {
  const pubs = publications || member.publications || [];
  const hasAuthorship = pubs.some((pub) => pub?.authorship);
  if (hasAuthorship) {
    let first = 0;
    let last = 0;
    let known = 0;
    pubs.forEach((pub) => {
      if (!pub?.authorship) {
        return;
      }
      known += 1;
      if (pub.authorship.isFirst) {
        first += 1;
      }
      if (pub.authorship.isLast) {
        last += 1;
      }
    });
    return known ? { first, last, total: pubs.length, known } : null;
  }
  return member.authorCounts || member.signals?.positive?.authorCounts || null;
};

const formatAuthorshipLabel = (authorship) => {
  if (!authorship) {
    return { label: '—', title: 'Authorship position unknown.', isKnown: false };
  }
  let label = 'Middle';
  if (authorship.isFirst && authorship.isLast) {
    label = 'Sole';
  } else if (authorship.isFirst) {
    label = 'First';
  } else if (authorship.isLast) {
    label = 'Last';
  }
  const position = Number.isFinite(authorship.position) ? authorship.position + 1 : null;
  const total = Number.isFinite(authorship.total) ? authorship.total : null;
  const title =
    position && total
      ? `Author position ${position} of ${total}.`
      : 'Authorship position known.';
  return { label, title, isKnown: true };
};

const csvEscape = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (text.includes('"')) {
    text = text.replace(/"/g, '""');
  }
  if (/[",\n]/.test(text)) {
    return `"${text}"`;
  }
  return text;
};

const buildCsv = (headers, rows) => {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((row) => {
    lines.push(row.map(csvEscape).join(','));
  });
  return lines.join('\n');
};

const downloadCsv = (filename, headers, rows) => {
  const csv = `\ufeff${buildCsv(headers, rows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const buildExportFilename = (prefix, updated) => {
  const fallback = new Date().toISOString().slice(0, 10);
  const stamp = String(updated || fallback).trim();
  const safeStamp = stamp
    .replace(/[^0-9a-z-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}-${safeStamp || fallback}.csv`;
};
const joinList = (values, fallback = '—') =>
  values && values.length ? values.filter(Boolean).join(' | ') : fallback;
const formatFilterList = (values) => joinList(values, 'All');
const joinComma = (values, fallback = '—') =>
  values && values.length ? values.filter(Boolean).join(', ') : fallback;

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1
});

const formatCompactNumber = (value) =>
  Number.isFinite(value) ? compactNumberFormatter.format(value) : '—';

const formatCompactCurrency = (value) =>
  Number.isFinite(value) ? compactCurrencyFormatter.format(value) : '—';

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0
});

const formatPercent = (value) =>
  Number.isFinite(value) ? percentFormatter.format(value) : '—';

const sanitizeFileToken = (value) =>
  String(value || 'chart')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildChartFilename = (title, updated, extension) => {
  const fallback = new Date().toISOString().slice(0, 10);
  const stamp = sanitizeFileToken(updated || fallback);
  const base = sanitizeFileToken(title);
  return `${base || 'chart'}-${stamp || fallback}.${extension}`;
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const getSvgDimensions = (svgEl) => {
  if (!svgEl) {
    return { width: 0, height: 0 };
  }
  const viewBox = svgEl.viewBox?.baseVal;
  if (viewBox && viewBox.width && viewBox.height) {
    return { width: viewBox.width, height: viewBox.height };
  }
  const width = Number(svgEl.getAttribute('width')) || svgEl.getBoundingClientRect().width;
  const height =
    Number(svgEl.getAttribute('height')) || svgEl.getBoundingClientRect().height;
  return { width, height };
};

const serializeSvg = (svgEl) => {
  if (!svgEl) {
    return '';
  }
  const clone = svgEl.cloneNode(true);
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  const { width, height } = getSvgDimensions(svgEl);
  if (width) {
    clone.setAttribute('width', width);
  }
  if (height) {
    clone.setAttribute('height', height);
  }
  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
};

const downloadSvg = (svgEl, filename) => {
  if (!svgEl) {
    return;
  }
  const svgText = serializeSvg(svgEl);
  if (!svgText) {
    return;
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
};

const downloadPng = (svgEl, filename, options = {}) => {
  if (!svgEl) {
    return;
  }
  const svgText = serializeSvg(svgEl);
  if (!svgText) {
    return;
  }
  const { width, height } = getSvgDimensions(svgEl);
  if (!width || !height) {
    return;
  }
  const { background = '#ffffff', scale = 2 } = options;
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) {
      URL.revokeObjectURL(url);
      return;
    }
    context.scale(scale, scale);
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, filename);
      }
      URL.revokeObjectURL(url);
    }, 'image/png');
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
  };
  image.src = url;
};

const trimSeries = (series, max = 12) => {
  if (!series || series.length <= max) {
    return series || [];
  }
  return series.slice(series.length - max);
};

const collapseSegments = (segments, limit = 5, otherLabel = 'Other') => {
  const filtered = (segments || []).filter((segment) => segment.value > 0);
  const sorted = [...filtered].sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) {
    return sorted;
  }
  const top = sorted.slice(0, limit - 1);
  const otherValue = sorted.slice(limit - 1).reduce((sum, segment) => sum + segment.value, 0);
  return [...top, { label: otherLabel, value: otherValue }];
};

const truncateLabel = (label, max = 10) => {
  const text = String(label || '');
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
};

const getYearFromDate = (value) => {
  if (!value) {
    return null;
  }
  const match = String(value).match(/^(\d{4})/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
};

const getGrantYear = (grant) =>
  (Number.isFinite(grant?.fiscalYear) && grant.fiscalYear) ||
  getYearFromDate(grant?.startDate) ||
  getYearFromDate(grant?.endDate);

const getAuthorshipCategory = (authorship) => {
  if (!authorship) {
    return 'Unknown';
  }
  if (authorship.isFirst && authorship.isLast) {
    return 'Sole';
  }
  if (authorship.isFirst) {
    return 'First';
  }
  if (authorship.isLast) {
    return 'Last';
  }
  return 'Middle';
};

const CHART_COLORS = [
  '#1f5ca7',
  '#2f8bc1',
  '#2aa58b',
  '#f0b429',
  '#ee6c4d',
  '#7c8f3b'
];

const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians)
  };
};

const describeDonutArc = (centerX, centerY, outerRadius, innerRadius, startAngle, endAngle) => {
  const outerStart = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z'
  ].join(' ');
};

const ChartCard = ({
  title,
  subtitle,
  onDownloadSvg,
  onDownloadPng,
  actionsDisabled,
  children,
  legend,
  detail
}) => (
  <article className="chart-card">
    <header className="chart-head">
      <div>
        <p className="chart-title">{title}</p>
        {subtitle ? <p className="chart-subtitle">{subtitle}</p> : null}
      </div>
      <div className="chart-actions">
        <button
          type="button"
          className="chart-button"
          onClick={onDownloadSvg}
          disabled={actionsDisabled}
          title="Download as SVG"
        >
          SVG
        </button>
        <button
          type="button"
          className="chart-button"
          onClick={onDownloadPng}
          disabled={actionsDisabled}
          title="Download as PNG"
        >
          PNG
        </button>
      </div>
    </header>
    <div className="chart-body">{children}</div>
    {legend}
    {detail}
  </article>
);

const ChartLegend = ({ segments, total, hiddenMap = {}, onToggle }) => (
  <div className="chart-legend">
    {segments.map((segment, index) => {
      const isHidden = Boolean(hiddenMap[segment.label]);
      return (
        <button
          type="button"
          key={`${segment.label}-${index}`}
          className={`legend-item ${isHidden ? 'is-muted' : ''}`}
          onClick={onToggle ? () => onToggle(segment.label) : undefined}
          aria-pressed={!isHidden}
          disabled={!onToggle}
          title={onToggle ? 'Toggle segment' : undefined}
        >
          <span className="legend-swatch" style={{ '--swatch': segment.color }} />
          <span>{segment.label}</span>
          <strong>{formatPercent(total ? segment.value / total : 0)}</strong>
        </button>
      );
    })}
  </div>
);

const ChartDetail = ({ title, lines, onClear }) => {
  if (!lines?.length) {
    return null;
  }
  return (
    <div className="chart-detail">
      <div className="chart-detail-head">
        <p className="chart-detail-title">{title}</p>
        {onClear ? (
          <button type="button" className="chart-detail-clear" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="chart-detail-lines">
        {lines.map((line, index) => (
          <div key={`${line}-${index}`} className="chart-detail-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

const LineChart = ({
  id,
  data,
  width = 520,
  height = 220,
  accent = '#1f5ca7',
  ariaLabel,
  valueFormatter = formatCompactNumber,
  onSelect,
  selectedLabel
}) => {
  if (!data || data.length === 0) {
    return null;
  }
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredLabel, setHoveredLabel] = useState(null);
  const padding = { top: 28, right: 24, bottom: 36, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.map((entry) => entry.value), 1);
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const baseline = padding.top + plotHeight;
  const points = data.map((entry, index) => {
    const x =
      data.length > 1 ? padding.left + index * step : padding.left + plotWidth / 2;
    const y = baseline - (entry.value / maxValue) * plotHeight;
    return { x, y, label: entry.label, value: entry.value };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath = [
    `M ${points[0].x} ${baseline}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${points[points.length - 1].x} ${baseline}`,
    'Z'
  ].join(' ');
  const gridYValues = [0, 0.5, 1];
  const activeLabel = hoveredLabel ?? selectedLabel;

  const getTooltipPosition = (event) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return null;
    }
    const targetBounds = event.currentTarget?.getBoundingClientRect?.();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (!event.clientX && targetBounds) {
      x = targetBounds.left + targetBounds.width / 2 - bounds.left;
      y = targetBounds.top - bounds.top;
    }
    x = Math.min(Math.max(x, 16), bounds.width - 16);
    y = Math.min(Math.max(y, 16), bounds.height - 16);
    return { x, y };
  };

  const showTooltip = (event, entry) => {
    const position = getTooltipPosition(event);
    if (!position) {
      return;
    }
    setTooltip({
      ...position,
      label: entry.label,
      value: entry.value
    });
  };

  const clearTooltip = () => {
    setTooltip(null);
    setHoveredLabel(null);
  };

  return (
    <div className="chart-shell" ref={containerRef} onMouseLeave={clearTooltip}>
      <svg
        ref={id?.ref}
        className="chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient
            id={`line-gradient-${id?.name || 'line'}`}
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" rx="16" fill="#ffffff" />
        <g stroke="#e6ebf1" strokeWidth="1">
          {gridYValues.map((value) => {
            const y = baseline - value * plotHeight;
            return (
              <line
                key={value}
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
            );
          })}
        </g>
        <path
          d={areaPath}
          fill={`url(#line-gradient-${id?.name || 'line'})`}
          className="chart-area"
        />
        <path d={linePath} fill="none" stroke={accent} strokeWidth="2.5" className="chart-line" />
        {points.map((point) => {
          const isActive = activeLabel === point.label;
          const isDimmed = activeLabel && !isActive;
          return (
              <circle
                key={point.label}
                cx={point.x}
                cy={point.y}
                r={isActive ? 5 : 4}
                fill={accent}
                className={`chart-point ${isActive ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                tabIndex={0}
                role="button"
                aria-label={`${point.label}: ${valueFormatter(point.value)}`}
                onMouseEnter={(event) => {
                  setHoveredLabel(point.label);
                  showTooltip(event, point);
                }}
              onMouseMove={(event) => showTooltip(event, point)}
              onFocus={(event) => {
                setHoveredLabel(point.label);
                showTooltip(event, point);
              }}
              onBlur={clearTooltip}
              onClick={() => onSelect?.(point)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(point);
                }
              }}
            />
          );
        })}
        <text
          x={padding.left}
          y={height - 12}
          fontFamily="IBM Plex Sans, system-ui, sans-serif"
          fontSize="11"
          fill="#5a6872"
        >
          {points[0].label}
        </text>
        <text
          x={width - padding.right}
          y={height - 12}
          textAnchor="end"
          fontFamily="IBM Plex Sans, system-ui, sans-serif"
          fontSize="11"
          fill="#5a6872"
        >
          {points[points.length - 1].label}
        </text>
        <text
          x={width - padding.right}
          y={padding.top - 8}
          textAnchor="end"
          fontFamily="IBM Plex Sans, system-ui, sans-serif"
          fontSize="12"
          fill="#1f5ca7"
        >
          {valueFormatter(maxValue)}
        </text>
      </svg>
      {tooltip ? (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="chart-tooltip-title">{tooltip.label}</div>
          <div className="chart-tooltip-value">{valueFormatter(tooltip.value)}</div>
        </div>
      ) : null}
    </div>
  );
};

const BarChart = ({
  id,
  data,
  width = 520,
  height = 220,
  accent = '#1f5ca7',
  ariaLabel,
  valueFormatter = formatCompactNumber,
  labelFormatter = truncateLabel,
  onSelect,
  selectedLabel
}) => {
  if (!data || data.length === 0) {
    return null;
  }
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredLabel, setHoveredLabel] = useState(null);
  const padding = { top: 28, right: 20, bottom: 44, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.map((entry) => entry.value), 1);
  const gap = data.length > 1 ? Math.min(18, plotWidth / (data.length * 2)) : 0;
  const barWidth =
    data.length > 0 ? (plotWidth - gap * (data.length - 1)) / data.length : plotWidth;
  const activeLabel = hoveredLabel ?? selectedLabel;

  const getTooltipPosition = (event) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return null;
    }
    const targetBounds = event.currentTarget?.getBoundingClientRect?.();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (!event.clientX && targetBounds) {
      x = targetBounds.left + targetBounds.width / 2 - bounds.left;
      y = targetBounds.top - bounds.top;
    }
    x = Math.min(Math.max(x, 16), bounds.width - 16);
    y = Math.min(Math.max(y, 16), bounds.height - 16);
    return { x, y };
  };

  const showTooltip = (event, entry) => {
    const position = getTooltipPosition(event);
    if (!position) {
      return;
    }
    setTooltip({
      ...position,
      label: entry.label,
      value: entry.value
    });
  };

  const clearTooltip = () => {
    setTooltip(null);
    setHoveredLabel(null);
  };

  return (
    <div className="chart-shell" ref={containerRef} onMouseLeave={clearTooltip}>
      <svg
        ref={id?.ref}
        className="chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient
            id={`bar-gradient-${id?.name || 'bar'}`}
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" rx="16" fill="#ffffff" />
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={width - padding.right}
          y2={padding.top + plotHeight}
          stroke="#dce2ea"
          strokeWidth="1"
        />
        {data.map((entry, index) => {
          const heightRatio = entry.value / maxValue;
          const barHeight = heightRatio * plotHeight;
          const x = padding.left + index * (barWidth + gap);
          const y = padding.top + (plotHeight - barHeight);
          const isActive = activeLabel === entry.label;
          const isDimmed = activeLabel && !isActive;
          return (
            <g key={`${entry.label}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="6"
                fill={`url(#bar-gradient-${id?.name || 'bar'})`}
                className={`chart-bar ${isActive ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                tabIndex={0}
                role="button"
                aria-label={`${entry.label}: ${valueFormatter(entry.value)}`}
                onMouseEnter={(event) => {
                  setHoveredLabel(entry.label);
                  showTooltip(event, entry);
                }}
                onMouseMove={(event) => showTooltip(event, entry)}
                onFocus={(event) => {
                  setHoveredLabel(entry.label);
                  showTooltip(event, entry);
                }}
                onBlur={clearTooltip}
                onClick={() => onSelect?.(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(entry);
                  }
                }}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                fontFamily="IBM Plex Sans, system-ui, sans-serif"
                fontSize="11"
                fill="#1f5ca7"
                className={`chart-bar-label ${isDimmed ? 'is-dimmed' : ''}`}
              >
                {valueFormatter(entry.value)}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 14}
                textAnchor="middle"
                fontFamily="IBM Plex Sans, system-ui, sans-serif"
                fontSize="11"
                fill="#5a6872"
                className={`chart-bar-label ${isDimmed ? 'is-dimmed' : ''}`}
              >
                {labelFormatter(entry.label)}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip ? (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="chart-tooltip-title">{tooltip.label}</div>
          <div className="chart-tooltip-value">{valueFormatter(tooltip.value)}</div>
        </div>
      ) : null}
    </div>
  );
};

const DonutChart = ({
  id,
  segments,
  width = 520,
  height = 220,
  ariaLabel,
  centerLabel,
  centerValue,
  onSelect,
  selectedLabel
}) => {
  if (!segments || segments.length === 0) {
    return null;
  }
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) {
    return null;
  }
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredLabel, setHoveredLabel] = useState(null);
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) / 2 - 24;
  const innerRadius = outerRadius * 0.6;
  let currentAngle = 0;
  const activeLabel = hoveredLabel ?? selectedLabel;

  const getTooltipPosition = (event) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return null;
    }
    const targetBounds = event.currentTarget?.getBoundingClientRect?.();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (!event.clientX && targetBounds) {
      x = targetBounds.left + targetBounds.width / 2 - bounds.left;
      y = targetBounds.top - bounds.top;
    }
    x = Math.min(Math.max(x, 16), bounds.width - 16);
    y = Math.min(Math.max(y, 16), bounds.height - 16);
    return { x, y };
  };

  const showTooltip = (event, segment) => {
    const position = getTooltipPosition(event);
    if (!position) {
      return;
    }
    setTooltip({
      ...position,
      label: segment.label,
      value: segment.value,
      percent: formatPercent(segment.value / total)
    });
  };

  const clearTooltip = () => {
    setTooltip(null);
    setHoveredLabel(null);
  };

  return (
    <div className="chart-shell" ref={containerRef} onMouseLeave={clearTooltip}>
      <svg
        ref={id?.ref}
        className="chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <rect width="100%" height="100%" rx="16" fill="#ffffff" />
        {segments.map((segment, index) => {
          const startAngle = currentAngle;
          const sweep = total ? (segment.value / total) * 360 : 0;
          const endAngle = currentAngle + sweep;
          currentAngle = endAngle;
          const color = segment.color || CHART_COLORS[index % CHART_COLORS.length];
          const isActive = activeLabel === segment.label;
          const isDimmed = activeLabel && !isActive;
          return (
            <path
              key={`${segment.label}-${segment.value}`}
              d={describeDonutArc(
                centerX,
                centerY,
                outerRadius,
                innerRadius,
                startAngle,
                endAngle
              )}
              fill={color}
              className={`chart-arc ${isActive ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={`${segment.label}: ${formatPercent(segment.value / total)}`}
              onMouseEnter={(event) => {
                setHoveredLabel(segment.label);
                showTooltip(event, segment);
              }}
              onMouseMove={(event) => showTooltip(event, segment)}
              onFocus={(event) => {
                setHoveredLabel(segment.label);
                showTooltip(event, segment);
              }}
              onBlur={clearTooltip}
              onClick={() => onSelect?.(segment)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(segment);
                }
              }}
            />
          );
        })}
        <circle cx={centerX} cy={centerY} r={innerRadius} fill="#ffffff" />
        <text
          x={centerX}
          y={centerY - 6}
          textAnchor="middle"
          fontFamily="IBM Plex Sans, system-ui, sans-serif"
          fontSize="12"
          fill="#5a6872"
        >
          {centerLabel}
        </text>
        <text
          x={centerX}
          y={centerY + 14}
          textAnchor="middle"
          fontFamily="IBM Plex Sans, system-ui, sans-serif"
          fontSize="18"
          fontWeight="600"
          fill="#1f5ca7"
        >
          {centerValue}
        </text>
      </svg>
      {tooltip ? (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="chart-tooltip-title">{tooltip.label}</div>
          <div className="chart-tooltip-value">{tooltip.percent}</div>
        </div>
      ) : null}
    </div>
  );
};

export default function App() {
  const [pubData, setPubData] = useState({ updated: '', source: '', faculty: [] });
  const [grantData, setGrantData] = useState({ updated: '', source: '', faculty: [] });
  const [pubStatus, setPubStatus] = useState('loading');
  const [grantStatus, setGrantStatus] = useState('loading');
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'grants' ? 'grants' : 'publications';
  });
  const [query, setQuery] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [pubSortBy, setPubSortBy] = useState('name');
  const [grantSortBy, setGrantSortBy] = useState('name');
  const [programFilters, setProgramFilters] = useState([]);
  const [grantTypeFilters, setGrantTypeFilters] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [stickyActive, setStickyActive] = useState(false);
  const stickyRef = useRef(null);
  const pubTrendRef = useRef(null);
  const pubProgramRef = useRef(null);
  const pubAuthorshipRef = useRef(null);
  const grantFundingRef = useRef(null);
  const grantTypeRef = useRef(null);
  const grantTopRef = useRef(null);
  const [chartSelections, setChartSelections] = useState({
    pubTrend: null,
    pubProgram: null,
    pubAuthorship: null,
    grantYear: null,
    grantType: null,
    grantTop: null
  });
  const [hiddenAuthorship, setHiddenAuthorship] = useState({});
  const [hiddenGrantTypes, setHiddenGrantTypes] = useState({});

  const setSelection = (key, value) => {
    setChartSelections((current) => ({ ...current, [key]: value }));
  };

  const clearSelection = (key) => {
    setChartSelections((current) => ({ ...current, [key]: null }));
  };

  const toggleHiddenAuthorship = (label) => {
    setHiddenAuthorship((current) => ({
      ...current,
      [label]: !current[label]
    }));
  };

  const toggleHiddenGrantTypes = (label) => {
    setHiddenGrantTypes((current) => ({
      ...current,
      [label]: !current[label]
    }));
  };

  const handleTabChange = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === 'grants') {
      url.searchParams.set('tab', 'grants');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    let active = true;

    const loadDataset = async (url, setPayload, setState) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('missing');
          }
          throw new Error(`Failed to load data (${response.status})`);
        }
        const payload = await response.json();
        if (active) {
          setPayload(payload);
          setState('ready');
        }
      } catch (error) {
        console.error(error);
        if (active) {
          setState(error.message === 'missing' ? 'missing' : 'error');
        }
      }
    };

    loadDataset(PUBLICATIONS_URL, setPubData, setPubStatus);
    loadDataset(GRANTS_URL, setGrantData, setGrantStatus);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const currentStatus = tab === 'publications' ? pubStatus : grantStatus;
    if (currentStatus !== 'ready') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const facultyParam =
      params.get('faculty') || params.get('name') || params.get('researcher');
    if (!facultyParam) {
      return;
    }
    const key = normalizeKey(facultyParam);
    const slug = normalizeSlug(facultyParam);
    const facultyList = tab === 'publications' ? pubData.faculty : grantData.faculty;
    const match = facultyList.find((member) => {
      const idKey = normalizeKey(member.id);
      const nameKey = normalizeKey(member.name);
      return (
        idKey === key ||
        nameKey === key ||
        normalizeSlug(member.name) === slug ||
        normalizeSlug(member.id) === slug
      );
    });
    if (match) {
      setQuery(match.name);
      setOpenId(match.id);
    }
  }, [tab, pubStatus, grantStatus, pubData.faculty, grantData.faculty]);

  const handleCopyLink = async (member) => {
    const url = new URL(window.location.href);
    url.searchParams.set('faculty', member.id);
    if (tab === 'grants') {
      url.searchParams.set('tab', 'grants');
    } else {
      url.searchParams.delete('tab');
    }
    const link = url.toString();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement('input');
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopiedId(member.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === member.id ? null : current));
      }, 1500);
    } catch (error) {
      console.error('Failed to copy link', error);
    }
  };

  const yearBounds = useMemo(() => {
    const years = pubData.faculty.flatMap((member) =>
      member.publications.map((pub) => pub.year)
    );
    if (!years.length) {
      return { min: '', max: '' };
    }
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [pubData]);

  useEffect(() => {
    if (yearBounds.min && yearBounds.max) {
      setYearMin(yearBounds.min);
      setYearMax(yearBounds.max);
    }
  }, [yearBounds]);

  const activeYearRange = useMemo(() => {
    const min = toNumber(yearMin) ?? yearBounds.min;
    const max = toNumber(yearMax) ?? yearBounds.max;
    return {
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null
    };
  }, [yearMin, yearMax, yearBounds]);

  const toggleProgramFilter = (program) => {
    if (!program) {
      return;
    }
    setProgramFilters((current) =>
      current.includes(program)
        ? current.filter((entry) => entry !== program)
        : [...current, program]
    );
  };

  const toggleGrantTypeFilter = (type) => {
    if (!type) {
      return;
    }
    setGrantTypeFilters((current) =>
      current.includes(type)
        ? current.filter((entry) => entry !== type)
        : [...current, type]
    );
  };

  const handleClearFilters = () => {
    setQuery('');
    setProgramFilters([]);
    setGrantTypeFilters([]);
    setChartSelections({
      pubTrend: null,
      pubProgram: null,
      pubAuthorship: null,
      grantYear: null,
      grantType: null,
      grantTop: null
    });
    setHiddenAuthorship({});
    setHiddenGrantTypes({});
    if (tab === 'publications') {
      setPubSortBy('name');
      if (yearBounds.min && yearBounds.max) {
        setYearMin(yearBounds.min);
        setYearMax(yearBounds.max);
      } else {
        setYearMin('');
        setYearMax('');
      }
    } else {
      setGrantSortBy('name');
    }
    setOpenId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('faculty');
    url.searchParams.delete('name');
    url.searchParams.delete('researcher');
    if (tab === 'grants') {
      url.searchParams.set('tab', 'grants');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState({}, '', url.toString());
  };

  const handleSelectPublicationYear = (entry) => {
    if (!entry?.label) {
      return;
    }
    setSelection('pubTrend', entry);
    setYearMin(String(entry.label));
    setYearMax(String(entry.label));
  };

  const handleSelectProgramSpotlight = (entry) => {
    if (!entry?.label) {
      return;
    }
    setSelection('pubProgram', entry);
    if (entry.label !== 'Other') {
      toggleProgramFilter(entry.label);
    }
  };

  const handleSelectAuthorship = (segment) => {
    if (!segment?.label) {
      return;
    }
    setSelection('pubAuthorship', segment);
  };

  const handleSelectGrantYear = (entry) => {
    if (!entry?.label) {
      return;
    }
    setSelection('grantYear', entry);
  };

  const handleSelectGrantType = (segment) => {
    if (!segment?.label) {
      return;
    }
    setSelection('grantType', segment);
    toggleGrantTypeFilter(segment.label);
  };

  const handleSelectTopFaculty = (entry) => {
    if (!entry?.label) {
      return;
    }
    setSelection('grantTop', entry);
    setQuery(entry.label);
    const match = filteredGrants.find((member) => member.name === entry.label);
    if (match) {
      setOpenId(match.id);
    }
  };

  const filteredPublications = useMemo(() => {
    const needle = normalize(query.trim());

    const facultyWithFilteredPubs = pubData.faculty.map((member) => {
      const pubsInRange = member.publications.filter((pub) => {
        const inMin = yearMin ? pub.year >= Number(yearMin) : true;
        const inMax = yearMax ? pub.year <= Number(yearMax) : true;
        return inMin && inMax;
      });

      const searchableBits = [
        member.name,
        member.department,
        ...(member.areas || []),
        ...(member.programs || []),
        ...pubsInRange.map((pub) => `${pub.title} ${pub.journal}`)
      ]
        .filter(Boolean)
        .join(' ');

      const matchesQuery = needle
        ? normalize(searchableBits).includes(needle)
        : true;

      const matchesPrograms = programFilters.length
        ? (member.programs || []).some((program) => programFilters.includes(program))
        : true;

      return {
        ...member,
        filteredPublications: pubsInRange,
        matchesQuery,
        matchesPrograms
      };
    });

    const filtered = facultyWithFilteredPubs.filter(
      (member) =>
        member.filteredPublications.length > 0 &&
        member.matchesQuery &&
        member.matchesPrograms
    );

    const sorted = [...filtered].sort((a, b) => {
      if (pubSortBy === 'count') {
        return b.filteredPublications.length - a.filteredPublications.length;
      }
      if (pubSortBy === 'latest') {
        const aLatest = Math.max(...a.filteredPublications.map((pub) => pub.year));
        const bLatest = Math.max(...b.filteredPublications.map((pub) => pub.year));
        return bLatest - aLatest;
      }
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [pubData, query, pubSortBy, yearMin, yearMax, programFilters]);

  const filteredGrants = useMemo(() => {
    const needle = normalize(query.trim());

    const facultyWithFilteredGrants = grantData.faculty.map((member) => {
      const grants = member.grants || [];
      const searchableBits = [
        member.name,
        member.department,
        ...(member.areas || []),
        ...(member.programs || []),
        ...grants.map(
          (grant) =>
            `${grant.title} ${grant.id} ${grant.coreProjectNum || ''} ${extractCoreGrantNumber(
              grant.id
            )} ${getGrantGroupInfo(grant).type || ''}`
        )
      ]
        .filter(Boolean)
        .join(' ');

      const matchesQuery = needle
        ? normalize(searchableBits).includes(needle)
        : true;

      const matchesPrograms = programFilters.length
        ? (member.programs || []).some((program) => programFilters.includes(program))
        : true;

      const totalAmount = grants.reduce(
        (sum, grant) => sum + (Number.isFinite(grant.amount) ? grant.amount : 0),
        0
      );
      const hasAmount = grants.some((grant) => Number.isFinite(grant.amount));

      const groupedMap = new Map();
      grants.forEach((grant) => {
        const groupInfo = getGrantGroupInfo(grant);
        if (!groupedMap.has(groupInfo.key)) {
          groupedMap.set(groupInfo.key, {
            coreNumber: groupInfo.displayNumber,
            type: groupInfo.type,
            awards: [],
            totalAmount: 0,
            latestEnd: '',
            titles: new Set()
          });
        }
        const group = groupedMap.get(groupInfo.key);
        group.awards.push(grant);
        if (Number.isFinite(grant.amount)) {
          group.totalAmount += grant.amount;
        }
        if (grant.endDate && grant.endDate > group.latestEnd) {
          group.latestEnd = grant.endDate;
        }
        if (grant.title) {
          group.titles.add(grant.title);
        }
      });

      const groupedGrants = Array.from(groupedMap.values())
        .map((group) => {
          const titleList = Array.from(group.titles);
          let title = '';
          if (titleList.length === 1) {
            title = titleList[0];
          } else if (titleList.length > 1) {
            title = 'Multiple project titles';
          }
          return {
            coreNumber: group.coreNumber,
            type: group.type,
            title,
            totalAmount: group.totalAmount,
            latestEnd: group.latestEnd,
            awards: [...group.awards].sort((a, b) =>
              (b.startDate || '').localeCompare(a.startDate || '')
            )
          };
        })
        .sort((a, b) => (b.latestEnd || '').localeCompare(a.latestEnd || ''));

      const grantTypes = Array.from(
        new Set(groupedGrants.map((group) => group.type).filter(Boolean))
      ).sort();

      const matchesGrantTypes = grantTypeFilters.length
        ? grantTypes.some((type) => grantTypeFilters.includes(type))
        : true;

      return {
        ...member,
        filteredGrants: grants,
        groupedGrants,
        grantCount: groupedGrants.length,
        grantTypes,
        matchesQuery,
        matchesPrograms,
        matchesGrantTypes,
        totalAmount,
        hasAmount
      };
    });

    const filtered = facultyWithFilteredGrants.filter(
      (member) =>
        member.groupedGrants.length > 0 &&
        member.matchesQuery &&
        member.matchesPrograms &&
        member.matchesGrantTypes
    );

    const sorted = [...filtered].sort((a, b) => {
      if (grantSortBy === 'count') {
        return b.grantCount - a.grantCount;
      }
      if (grantSortBy === 'amount') {
        return (b.totalAmount || 0) - (a.totalAmount || 0);
      }
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [grantData, query, grantSortBy, programFilters, grantTypeFilters]);

  const activeFaculty = tab === 'publications' ? filteredPublications : filteredGrants;

  useEffect(() => {
    setOpenId(null);
    setStickyActive(false);
  }, [tab]);

  useEffect(() => {
    if (!openId) {
      return;
    }
    const target = document.getElementById(`faculty-${openId}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [openId, activeFaculty]);

  const totalPublications = useMemo(() => {
    return filteredPublications.reduce(
      (sum, member) => sum + member.filteredPublications.length,
      0
    );
  }, [filteredPublications]);

  const totalGrants = useMemo(() => {
    return filteredGrants.reduce(
      (sum, member) => sum + member.grantCount,
      0
    );
  }, [filteredGrants]);

  const totalGrantAmount = useMemo(() => {
    return filteredGrants.reduce(
      (sum, member) => sum + (member.totalAmount || 0),
      0
    );
  }, [filteredGrants]);

  const hasGrantAmounts = useMemo(() => {
    return filteredGrants.some((member) => member.hasAmount);
  }, [filteredGrants]);

  const allPublications = useMemo(
    () => filteredPublications.flatMap((member) => member.filteredPublications),
    [filteredPublications]
  );

  const publicationSeries = useMemo(
    () => trimSeries(buildYearSeries(allPublications, activeYearRange), 12),
    [allPublications, activeYearRange]
  );

  const publicationTrendData = useMemo(
    () =>
      publicationSeries.map((entry) => ({
        label: entry.year,
        value: entry.count
      })),
    [publicationSeries]
  );

  const programSeries = useMemo(() => {
    const counts = new Map();
    filteredPublications.forEach((member) => {
      const count = member.filteredPublications.length;
      if (!count) {
        return;
      }
      const programs = member.programs?.length ? member.programs : ['Unlisted'];
      programs.forEach((program) => {
        counts.set(program, (counts.get(program) || 0) + count);
      });
    });
    return Array.from(counts, ([label, value]) => ({ label, value })).sort(
      (a, b) => b.value - a.value
    );
  }, [filteredPublications]);

  const topProgramSeries = useMemo(() => {
    if (!programSeries.length) {
      return [];
    }
    const top = programSeries.slice(0, 5);
    if (programSeries.length <= 5) {
      return top;
    }
    const otherValue = programSeries
      .slice(5)
      .reduce((sum, entry) => sum + entry.value, 0);
    return [...top, { label: 'Other', value: otherValue }];
  }, [programSeries]);

  const authorshipSegments = useMemo(() => {
    const totals = {
      sole: 0,
      first: 0,
      last: 0,
      middle: 0,
      unknown: 0
    };
    allPublications.forEach((pub) => {
      if (!pub?.authorship) {
        totals.unknown += 1;
        return;
      }
      if (pub.authorship.isFirst && pub.authorship.isLast) {
        totals.sole += 1;
        return;
      }
      if (pub.authorship.isFirst) {
        totals.first += 1;
        return;
      }
      if (pub.authorship.isLast) {
        totals.last += 1;
        return;
      }
      totals.middle += 1;
    });
    const segments = [
      { label: 'Sole', value: totals.sole },
      { label: 'First', value: totals.first },
      { label: 'Last', value: totals.last },
      { label: 'Middle', value: totals.middle },
      { label: 'Unknown', value: totals.unknown }
    ].filter((segment) => segment.value > 0);
    return segments.map((segment, index) => ({
      ...segment,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));
  }, [allPublications]);

  const authorshipTotal = useMemo(
    () => authorshipSegments.reduce((sum, segment) => sum + segment.value, 0),
    [authorshipSegments]
  );

  const visibleAuthorshipSegments = useMemo(
    () => authorshipSegments.filter((segment) => !hiddenAuthorship[segment.label]),
    [authorshipSegments, hiddenAuthorship]
  );

  const visibleAuthorshipTotal = useMemo(
    () => visibleAuthorshipSegments.reduce((sum, segment) => sum + segment.value, 0),
    [visibleAuthorshipSegments]
  );

  const grantYearSeries = useMemo(() => {
    const totals = new Map();
    const counts = new Map();
    filteredGrants.forEach((member) => {
      (member.filteredGrants || []).forEach((grant) => {
        const year = getGrantYear(grant);
        if (!year) {
          return;
        }
        counts.set(year, (counts.get(year) || 0) + 1);
        if (Number.isFinite(grant.amount)) {
          totals.set(year, (totals.get(year) || 0) + grant.amount);
        }
      });
    });
    const years = Array.from(
      new Set([...totals.keys(), ...counts.keys()])
    ).sort((a, b) => a - b);
    return years.map((year) => ({
      year,
      total: totals.get(year) || 0,
      count: counts.get(year) || 0
    }));
  }, [filteredGrants]);

  const grantYearSeriesTrimmed = useMemo(
    () => trimSeries(grantYearSeries, 8),
    [grantYearSeries]
  );

  const grantYearData = useMemo(
    () =>
      grantYearSeriesTrimmed.map((entry) => ({
        label: entry.year,
        value: hasGrantAmounts ? entry.total : entry.count
      })),
    [grantYearSeriesTrimmed, hasGrantAmounts]
  );

  const grantTypeSegments = useMemo(() => {
    const counts = new Map();
    filteredGrants.forEach((member) => {
      member.groupedGrants.forEach((group) => {
        const label = group.type || 'Other';
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });
    const collapsed = collapseSegments(
      Array.from(counts, ([label, value]) => ({ label, value })),
      5,
      'Other'
    );
    return collapsed.map((segment, index) => ({
      ...segment,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));
  }, [filteredGrants]);

  const grantTypeTotal = useMemo(
    () => grantTypeSegments.reduce((sum, segment) => sum + segment.value, 0),
    [grantTypeSegments]
  );

  const visibleGrantTypeSegments = useMemo(
    () => grantTypeSegments.filter((segment) => !hiddenGrantTypes[segment.label]),
    [grantTypeSegments, hiddenGrantTypes]
  );

  const visibleGrantTypeTotal = useMemo(
    () => visibleGrantTypeSegments.reduce((sum, segment) => sum + segment.value, 0),
    [visibleGrantTypeSegments]
  );

  useEffect(() => {
    if (
      chartSelections.pubAuthorship &&
      hiddenAuthorship[chartSelections.pubAuthorship.label]
    ) {
      clearSelection('pubAuthorship');
    }
  }, [chartSelections.pubAuthorship, hiddenAuthorship]);

  useEffect(() => {
    if (
      chartSelections.grantType &&
      hiddenGrantTypes[chartSelections.grantType.label]
    ) {
      clearSelection('grantType');
    }
  }, [chartSelections.grantType, hiddenGrantTypes]);

  const topGrantFaculty = useMemo(() => {
    const ranked = filteredGrants.map((member) => ({
      label: member.name,
      value: hasGrantAmounts ? member.totalAmount || 0 : member.grantCount
    }));
    return ranked
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredGrants, hasGrantAmounts]);

  const hasPublicationTrend = publicationTrendData.some((entry) => entry.value > 0);
  const hasProgramSeries = topProgramSeries.some((entry) => entry.value > 0);
  const hasAuthorship = visibleAuthorshipSegments.some((entry) => entry.value > 0);
  const hasGrantYears = grantYearData.some((entry) => entry.value > 0);
  const hasGrantTypes = visibleGrantTypeSegments.some((entry) => entry.value > 0);
  const hasGrantTop = topGrantFaculty.some((entry) => entry.value > 0);
  const authorshipAllHidden =
    authorshipSegments.length > 0 && visibleAuthorshipSegments.length === 0;
  const grantTypesAllHidden =
    grantTypeSegments.length > 0 && visibleGrantTypeSegments.length === 0;

  const publicationTrendDetail = useMemo(() => {
    const selection = chartSelections.pubTrend;
    if (!selection) {
      return null;
    }
    const year = selection.label;
    const pubsInYear = allPublications.filter((pub) => pub.year === year);
    const total = pubsInYear.length;
    const facultyCounts = filteredPublications
      .map((member) => {
        const count = member.filteredPublications.filter((pub) => pub.year === year).length;
        return { name: member.name, count };
      })
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((entry) => `${entry.name} (${entry.count})`);
    const journalCounts = new Map();
    pubsInYear.forEach((pub) => {
      const journal = pub.journal || 'Unlisted';
      journalCounts.set(journal, (journalCounts.get(journal) || 0) + 1);
    });
    const topJournals = Array.from(journalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([journal, count]) => `${journal} (${count})`);
    return {
      title: `Year ${year}`,
      lines: [
        `Total publications: ${formatCompactNumber(total)}`,
        `Top faculty: ${joinComma(facultyCounts)}`,
        `Top journals: ${joinComma(topJournals)}`
      ]
    };
  }, [chartSelections.pubTrend, allPublications, filteredPublications]);

  const programSpotlightDetail = useMemo(() => {
    const selection = chartSelections.pubProgram;
    if (!selection) {
      return null;
    }
    const programLabel = selection.label;
    const isOther = programLabel === 'Other';
    const otherPrograms = programSeries.slice(5).map((entry) => entry.label);
    const activePrograms = isOther ? otherPrograms : [programLabel];
    const members = filteredPublications.filter((member) => {
      const programs = member.programs?.length ? member.programs : ['Unlisted'];
      return programs.some((program) => activePrograms.includes(program));
    });
    const total = members.reduce(
      (sum, member) => sum + member.filteredPublications.length,
      0
    );
    const topFaculty = members
      .map((member) => ({
        name: member.name,
        count: member.filteredPublications.length
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((entry) => `${entry.name} (${entry.count})`);
    const otherNote = isOther
      ? `Programs grouped: ${joinComma(otherPrograms.slice(0, 4))}${
          otherPrograms.length > 4 ? ` (+${otherPrograms.length - 4} more)` : ''
        }`
      : `Faculty in program: ${members.length}`;
    return {
      title: `Program ${programLabel}`,
      lines: [
        `Publications tagged ${programLabel}: ${formatCompactNumber(total)}`,
        `Top faculty: ${joinComma(topFaculty)}`,
        otherNote
      ]
    };
  }, [chartSelections.pubProgram, filteredPublications, programSeries]);

  const authorshipDetail = useMemo(() => {
    const selection = chartSelections.pubAuthorship;
    if (!selection) {
      return null;
    }
    const label = selection.label;
    const count = selection.value;
    const pubs = allPublications.filter(
      (pub) => getAuthorshipCategory(pub.authorship) === label
    );
    const latestYear = pubs.length
      ? Math.max(...pubs.map((pub) => pub.year || 0))
      : null;
    const topFaculty = filteredPublications
      .map((member) => {
        const tally = member.filteredPublications.filter(
          (pub) => getAuthorshipCategory(pub.authorship) === label
        ).length;
        return { name: member.name, count: tally };
      })
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((entry) => `${entry.name} (${entry.count})`);
    return {
      title: `${label} authorship`,
      lines: [
        `Publications: ${formatCompactNumber(count)}`,
        `Share of total: ${formatPercent(count / authorshipTotal)}`,
        `Top faculty: ${joinComma(topFaculty)}`,
        `Latest year: ${latestYear || '—'}`
      ]
    };
  }, [chartSelections.pubAuthorship, allPublications, filteredPublications, authorshipTotal]);

  const grantYearDetail = useMemo(() => {
    const selection = chartSelections.grantYear;
    if (!selection) {
      return null;
    }
    const year = selection.label;
    let totalAmount = 0;
    let awardCount = 0;
    const facultyTotals = filteredGrants.map((member) => {
      let memberAmount = 0;
      let memberCount = 0;
      (member.filteredGrants || []).forEach((grant) => {
        if (getGrantYear(grant) !== year) {
          return;
        }
        memberCount += 1;
        if (Number.isFinite(grant.amount)) {
          memberAmount += grant.amount;
        }
        if (Number.isFinite(grant.amount)) {
          totalAmount += grant.amount;
        }
        awardCount += 1;
      });
      return {
        name: member.name,
        amount: memberAmount,
        count: memberCount
      };
    });
    const topFaculty = facultyTotals
      .filter((entry) => (hasGrantAmounts ? entry.amount > 0 : entry.count > 0))
      .sort((a, b) =>
        hasGrantAmounts ? b.amount - a.amount : b.count - a.count
      )
      .slice(0, 3)
      .map((entry) =>
        hasGrantAmounts
          ? `${entry.name} (${formatCompactCurrency(entry.amount)})`
          : `${entry.name} (${entry.count})`
      );
    const lines = [
      hasGrantAmounts
        ? `Total awarded: ${formatCurrency(totalAmount)}`
        : `Awards counted: ${awardCount}`,
      hasGrantAmounts ? `Awards counted: ${awardCount}` : null,
      `Top faculty: ${joinComma(topFaculty)}`
    ].filter(Boolean);
    return {
      title: `Fiscal year ${year}`,
      lines
    };
  }, [chartSelections.grantYear, filteredGrants, hasGrantAmounts]);

  const grantTypeDetail = useMemo(() => {
    const selection = chartSelections.grantType;
    if (!selection) {
      return null;
    }
    const label = selection.label;
    const count = selection.value;
    const topFaculty = filteredGrants
      .map((member) => {
        const tally = member.groupedGrants.filter(
          (group) => (group.type || 'Other') === label
        ).length;
        return { name: member.name, count: tally };
      })
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((entry) => `${entry.name} (${entry.count})`);
    return {
      title: `${label} grants`,
      lines: [
        `Grants in view: ${formatCompactNumber(count)}`,
        `Share of total: ${formatPercent(count / grantTypeTotal)}`,
        `Top faculty: ${joinComma(topFaculty)}`
      ]
    };
  }, [chartSelections.grantType, filteredGrants, grantTypeTotal]);

  const grantTopDetail = useMemo(() => {
    const selection = chartSelections.grantTop;
    if (!selection) {
      return null;
    }
    const name = selection.label;
    const member = filteredGrants.find((entry) => entry.name === name);
    if (!member) {
      return null;
    }
    const latestEnd = member.groupedGrants.reduce((latest, grant) => {
      const end = grant.latestEnd || '';
      return end > latest ? end : latest;
    }, '');
    const topAwards = [...member.groupedGrants]
      .sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0))
      .slice(0, 3)
      .map((group) =>
        group.totalAmount
          ? `${group.coreNumber} (${formatCompactCurrency(group.totalAmount)})`
          : group.coreNumber
      );
    return {
      title: name,
      lines: [
        hasGrantAmounts
          ? `Total awarded: ${formatCurrency(member.totalAmount || 0)}`
          : `Grant count: ${member.grantCount}`,
        `Latest end date: ${latestEnd ? formatDate(latestEnd) : '—'}`,
        `Top awards: ${joinComma(topAwards)}`
      ]
    };
  }, [chartSelections.grantTop, filteredGrants, hasGrantAmounts]);

  const openMember = useMemo(() => {
    if (!openId) {
      return null;
    }
    return activeFaculty.find((member) => member.id === openId) || null;
  }, [activeFaculty, openId]);

  useEffect(() => {
    if (!openId) {
      setStickyActive(false);
      return;
    }

    const STICKY_OFFSET = 12;

    const listPrefix = tab === 'publications' ? 'pub-list' : 'grant-list';

    const handlePosition = () => {
      const listEl = document.getElementById(`${listPrefix}-${openId}`);
      if (!listEl) {
        setStickyActive(false);
        return;
      }
      const rect = listEl.getBoundingClientRect();
      const stickyHeight = stickyRef.current?.offsetHeight || 0;
      const withinTop = rect.top <= STICKY_OFFSET;
      const withinBottom = rect.bottom >= STICKY_OFFSET + stickyHeight + 8;
      setStickyActive(withinTop && withinBottom);
    };

    handlePosition();
    window.addEventListener('scroll', handlePosition, { passive: true });
    window.addEventListener('resize', handlePosition);
    return () => {
      window.removeEventListener('scroll', handlePosition);
      window.removeEventListener('resize', handlePosition);
    };
  }, [openId, tab]);

  const isPublications = tab === 'publications';
  const activeStatus = isPublications ? pubStatus : grantStatus;
  const activeData = isPublications ? pubData : grantData;
  const activeLabel = isPublications ? 'publications' : 'grants';
  const activeFile = isPublications
    ? 'public/data/publications.json'
    : 'public/data/grants.json';

  const getPublicationFilterValues = () => [
    query.trim() || 'All',
    yearMin ? String(yearMin) : 'All',
    yearMax ? String(yearMax) : 'All',
    formatFilterList(programFilters)
  ];

  const getGrantFilterValues = () => [
    query.trim() || 'All',
    formatFilterList(programFilters),
    formatFilterList(grantTypeFilters)
  ];

  const handleExportSummaryCsv = () => {
    if (isPublications) {
      const filterHeaders = [
        'Filter: Search',
        'Filter: Year Min',
        'Filter: Year Max',
        'Filter: Programs'
      ];
      const filterValues = getPublicationFilterValues();
      const headers = [
        'Faculty',
        'ORCID',
        'Affiliation',
        'Programs',
        'Publications',
        'Latest Year',
        'First Authorships',
        'Last Authorships',
        ...filterHeaders
      ];
      const rows = filteredPublications.map((member) => {
        const years = member.filteredPublications
          .map((pub) => pub.year)
          .filter((year) => Number.isFinite(year));
        const latestYear = years.length ? Math.max(...years) : '—';
        const authorCounts = getAuthorCounts(
          member,
          member.filteredPublications
        );
        return [
          member.name || '',
          member.orcid || '—',
          member.department || '',
          joinList(member.programs || []),
          member.filteredPublications.length || 0,
          latestYear,
          authorCounts ? authorCounts.first ?? 0 : '—',
          authorCounts ? authorCounts.last ?? 0 : '—',
          ...filterValues
        ];
      });
      downloadCsv(
        buildExportFilename('publications', pubData.updated),
        headers,
        rows
      );
      return;
    }

    const filterHeaders = ['Filter: Search', 'Filter: Programs', 'Filter: Grant Types'];
    const filterValues = getGrantFilterValues();
    const headers = [
      'Faculty',
      'Affiliation',
      'Programs',
      'Grant Types',
      'Grants',
      'Total Awarded',
      'Latest End',
      ...filterHeaders
    ];
    const rows = filteredGrants.map((member) => {
      const latestEnd = member.groupedGrants.reduce((latest, grant) => {
        const end = grant.latestEnd || '';
        return end > latest ? end : latest;
      }, '');
      return [
        member.name || '',
        member.department || '',
        joinList(member.programs || []),
        joinList(member.grantTypes || []),
        member.grantCount ?? 0,
        member.hasAmount ? formatCurrency(member.totalAmount) : '—',
        latestEnd ? formatDate(latestEnd) : '—',
        ...filterValues
      ];
    });
    downloadCsv(
      buildExportFilename('grants', grantData.updated),
      headers,
      rows
    );
  };

  const handleExportDetailedCsv = () => {
    if (isPublications) {
      const filterHeaders = [
        'Filter: Search',
        'Filter: Year Min',
        'Filter: Year Max',
        'Filter: Programs'
      ];
      const filterValues = getPublicationFilterValues();
      const headers = [
        'Faculty',
        'ORCID',
        'Affiliation',
        'Programs',
        'PMID',
        'Year',
        'Authorship',
        'Author Position',
        'Author Count',
        'Journal',
        'Title',
        'DOI',
        'URL',
        ...filterHeaders
      ];
      const rows = filteredPublications.flatMap((member) =>
        member.filteredPublications.map((pub) => {
          const authorship = formatAuthorshipLabel(pub.authorship);
          const position = Number.isFinite(pub.authorship?.position)
            ? pub.authorship.position + 1
            : '—';
          const total = Number.isFinite(pub.authorship?.total)
            ? pub.authorship.total
            : '—';
          return [
            member.name || '',
            member.orcid || '—',
            member.department || '',
            joinList(member.programs || []),
            pub.id || '—',
            Number.isFinite(pub.year) ? pub.year : '—',
            authorship.label,
            position,
            total,
            pub.journal || '—',
            pub.title || '—',
            pub.doi || '—',
            pub.url || '—',
            ...filterValues
          ];
        })
      );
      downloadCsv(
        buildExportFilename('publications-detailed', pubData.updated),
        headers,
        rows
      );
      return;
    }

    const filterHeaders = ['Filter: Search', 'Filter: Programs', 'Filter: Grant Types'];
    const filterValues = getGrantFilterValues();
    const headers = [
      'Faculty',
      'Affiliation',
      'Programs',
      'Grant Type',
      'Group Number',
      'Grant ID',
      'Core Project #',
      'Role',
      'Amount',
      'Start Date',
      'End Date',
      'Fiscal Year',
      'Project Title',
      'URL',
      ...filterHeaders
    ];
    const rows = filteredGrants.flatMap((member) =>
      (member.grants || []).map((grant) => {
        const groupInfo = getGrantGroupInfo(grant);
        return [
          member.name || '',
          member.department || '',
          joinList(member.programs || []),
          groupInfo.type || '—',
          groupInfo.displayNumber || '—',
          grant.id || '—',
          grant.coreProjectNum || extractCoreGrantNumber(grant.id) || '—',
          grant.role || '—',
          Number.isFinite(grant.amount) ? grant.amount : '—',
          grant.startDate ? formatDate(grant.startDate) : '—',
          grant.endDate ? formatDate(grant.endDate) : '—',
          Number.isFinite(grant.fiscalYear) ? grant.fiscalYear : '—',
          grant.title || '—',
          grant.url || '—',
          ...filterValues
        ];
      })
    );
    downloadCsv(
      buildExportFilename('grants-detailed', grantData.updated),
      headers,
      rows
    );
  };

  if (activeStatus === 'loading') {
    return (
      <main className="page">
        <section className="hero">
          <p className="eyebrow">CTSI Faculty Dashboard</p>
          <h1>Loading {activeLabel} data...</h1>
        </section>
      </main>
    );
  }

  if (activeStatus === 'error' || activeStatus === 'missing') {
    return (
      <main className="page">
        <section className="hero">
          <p className="eyebrow">CTSI Faculty Dashboard</p>
          <h1>We could not load the dataset.</h1>
          <p className="muted">
            Check the JSON file at <span className="mono">{activeFile}</span> and
            try again.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="topbar">
        <div className="tabs" role="tablist" aria-label="Dashboard sections">
          <button
            type="button"
            role="tab"
            aria-selected={isPublications}
            aria-controls="tab-panel-publications"
            id="tab-publications"
            className={`tab ${isPublications ? 'is-active' : ''}`}
            onClick={() => handleTabChange('publications')}
          >
            Publications
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isPublications}
            aria-controls="tab-panel-grants"
            id="tab-grants"
            className={`tab ${!isPublications ? 'is-active' : ''}`}
            onClick={() => handleTabChange('grants')}
          >
            Grants
          </button>
        </div>
      </div>
      <header className="hero">
        <p className="eyebrow">University of Minnesota CTSI</p>
        <h1>
          {isPublications ? 'Faculty Publication Dashboard' : 'Faculty Grant Dashboard'}
        </h1>
        <p className="lead">
          {isPublications
            ? 'Explore recent publications, filter by year, and highlight CTSI faculty output for grants, reports, and public engagement.'
            : 'Review NIH RePORTER grants tied to CTSI faculty and track award amounts across the program.'}
        </p>
        <div className="hero-meta">
          <div>
            <span className="label">Faculty in view</span>
            <strong>{activeFaculty.length}</strong>
          </div>
          {isPublications ? (
            <div>
              <span className="label">Publications in view</span>
              <strong>{totalPublications}</strong>
            </div>
          ) : (
            <div>
              <span className="label">Grant projects in view</span>
              <strong>{totalGrants}</strong>
            </div>
          )}
          {!isPublications ? (
            <div>
              <span className="label">Total awarded</span>
              <strong>
                {hasGrantAmounts ? formatCurrency(totalGrantAmount) : '—'}
              </strong>
            </div>
          ) : null}
          <div>
            <span className="label">Last updated</span>
            <strong>{activeData.updated || 'Unknown'}</strong>
          </div>
        </div>
        <div className="hero-actions">
          <a
            className="button"
            href={isPublications ? PUBLICATIONS_URL : GRANTS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Download JSON
          </a>
          <button
            type="button"
            className="button"
            onClick={handleExportSummaryCsv}
            title="Download the current table as a summary CSV"
          >
            Download Summary CSV
          </button>
          <button
            type="button"
            className="button"
            onClick={handleExportDetailedCsv}
            title="Download the detailed rows as CSV"
          >
            Download Detailed CSV
          </button>
          {activeData.source ? (
            <span className="tag">Source: {activeData.source}</span>
          ) : null}
        </div>
      </header>

      <section className="panel">
        <div className="panel-row">
          <label className="field">
            <span>Search</span>
            <input
              type="search"
              placeholder={
                isPublications ? 'Name, department, title' : 'Name, department, project'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {isPublications ? (
            <>
              <label className="field">
                <span>Start year</span>
                <input
                  type="number"
                  min={yearBounds.min || undefined}
                  max={yearBounds.max || undefined}
                  value={yearMin}
                  onChange={(event) => setYearMin(event.target.value)}
                />
              </label>
              <label className="field">
                <span>End year</span>
                <input
                  type="number"
                  min={yearBounds.min || undefined}
                  max={yearBounds.max || undefined}
                  value={yearMax}
                  onChange={(event) => setYearMax(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Sort by</span>
                <select
                  value={pubSortBy}
                  onChange={(event) => setPubSortBy(event.target.value)}
                >
                  <option value="name">Faculty name</option>
                  <option value="count">Publication count</option>
                  <option value="latest">Most recent year</option>
                </select>
              </label>
            </>
          ) : (
            <label className="field">
              <span>Sort by</span>
              <select
                value={grantSortBy}
                onChange={(event) => setGrantSortBy(event.target.value)}
              >
                <option value="name">Faculty name</option>
                <option value="count">Grant count</option>
                <option value="amount">Total awarded</option>
              </select>
            </label>
          )}
          <div className="field">
            <span>Reset</span>
            <button type="button" className="clear-button" onClick={handleClearFilters}>
              Clear filters
            </button>
          </div>
        </div>
        {programFilters.length || (!isPublications && grantTypeFilters.length) ? (
          <div className="active-filters">
            {programFilters.length ? (
              <>
                <span className="label">Program filters</span>
                <div className="chip-row">
                  {programFilters.map((program) => (
                    <button
                      key={program}
                      type="button"
                      className="chip is-active"
                      onClick={() => toggleProgramFilter(program)}
                      aria-pressed="true"
                    >
                      {program}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {!isPublications && grantTypeFilters.length ? (
              <>
                <span className="label">Grant type filters</span>
                <div className="chip-row">
                  {grantTypeFilters.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="chip is-active"
                      onClick={() => toggleGrantTypeFilter(type)}
                      aria-pressed="true"
                    >
                      {type}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="insights">
        <div className="insights-head">
          <div>
            <p className="eyebrow">Visualization Studio</p>
            <h2>Export-ready highlights</h2>
            <p className="muted">
              Download any chart as SVG or PNG for decks, docs, and reports.
            </p>
          </div>
          <div className="insights-note">
            <span className="tag">PNG + SVG exports</span>
            <span className="tag">Auto-updates with filters</span>
          </div>
        </div>
        <div className="insights-grid">
          {isPublications ? (
            <>
              <ChartCard
                title="Publication Pulse"
                subtitle="Year-over-year publication momentum"
                onDownloadSvg={() =>
                  downloadSvg(
                    pubTrendRef.current,
                    buildChartFilename('publication-pulse', activeData.updated, 'svg')
                  )
                }
                onDownloadPng={() =>
                  downloadPng(
                    pubTrendRef.current,
                    buildChartFilename('publication-pulse', activeData.updated, 'png')
                  )
                }
                actionsDisabled={!hasPublicationTrend}
                detail={
                  publicationTrendDetail ? (
                    <ChartDetail
                      title={publicationTrendDetail.title}
                      lines={publicationTrendDetail.lines}
                      onClear={() => clearSelection('pubTrend')}
                    />
                  ) : null
                }
              >
                {hasPublicationTrend ? (
                  <LineChart
                    id={{ name: 'pub-pulse', ref: pubTrendRef }}
                    data={publicationTrendData}
                    ariaLabel="Publication counts per year"
                    valueFormatter={formatCompactNumber}
                    onSelect={handleSelectPublicationYear}
                    selectedLabel={chartSelections.pubTrend?.label}
                  />
                ) : (
                  <div className="chart-empty">No publication trend data available.</div>
                )}
              </ChartCard>
              <ChartCard
                title="Program Spotlight"
                subtitle="Top programs by publication volume"
                onDownloadSvg={() =>
                  downloadSvg(
                    pubProgramRef.current,
                    buildChartFilename('program-spotlight', activeData.updated, 'svg')
                  )
                }
                onDownloadPng={() =>
                  downloadPng(
                    pubProgramRef.current,
                    buildChartFilename('program-spotlight', activeData.updated, 'png')
                  )
                }
                actionsDisabled={!hasProgramSeries}
                detail={
                  programSpotlightDetail ? (
                    <ChartDetail
                      title={programSpotlightDetail.title}
                      lines={programSpotlightDetail.lines}
                      onClear={() => clearSelection('pubProgram')}
                    />
                  ) : null
                }
              >
                {hasProgramSeries ? (
                  <BarChart
                    id={{ name: 'pub-programs', ref: pubProgramRef }}
                    data={topProgramSeries}
                    ariaLabel="Top programs by publication volume"
                    valueFormatter={formatCompactNumber}
                    onSelect={handleSelectProgramSpotlight}
                    selectedLabel={chartSelections.pubProgram?.label}
                  />
                ) : (
                  <div className="chart-empty">No program distribution data yet.</div>
                )}
              </ChartCard>
              <ChartCard
                title="Authorship Mix"
                subtitle="Where CTSI faculty land on author lists"
                onDownloadSvg={() =>
                  downloadSvg(
                    pubAuthorshipRef.current,
                    buildChartFilename('authorship-mix', activeData.updated, 'svg')
                  )
                }
                onDownloadPng={() =>
                  downloadPng(
                    pubAuthorshipRef.current,
                    buildChartFilename('authorship-mix', activeData.updated, 'png')
                  )
                }
                actionsDisabled={!hasAuthorship}
                legend={
                  hasAuthorship ? (
                    <ChartLegend
                      segments={authorshipSegments}
                      total={authorshipTotal}
                      hiddenMap={hiddenAuthorship}
                      onToggle={toggleHiddenAuthorship}
                    />
                  ) : null
                }
                detail={
                  authorshipDetail ? (
                    <ChartDetail
                      title={authorshipDetail.title}
                      lines={authorshipDetail.lines}
                      onClear={() => clearSelection('pubAuthorship')}
                    />
                  ) : null
                }
              >
                {hasAuthorship ? (
                  <DonutChart
                    id={{ name: 'pub-authorship', ref: pubAuthorshipRef }}
                    segments={visibleAuthorshipSegments}
                    centerLabel="Total roles"
                    centerValue={formatCompactNumber(visibleAuthorshipTotal)}
                    ariaLabel="Authorship role distribution"
                    onSelect={handleSelectAuthorship}
                    selectedLabel={chartSelections.pubAuthorship?.label}
                  />
                ) : (
                  <div className="chart-empty">
                    {authorshipAllHidden
                      ? 'All segments hidden. Toggle a legend item to show data.'
                      : 'No authorship role data available.'}
                  </div>
                )}
              </ChartCard>
            </>
          ) : (
            <>
              <ChartCard
                title="Funding Runway"
                subtitle="Awards by fiscal year"
                onDownloadSvg={() =>
                  downloadSvg(
                    grantFundingRef.current,
                    buildChartFilename('funding-runway', activeData.updated, 'svg')
                  )
                }
                onDownloadPng={() =>
                  downloadPng(
                    grantFundingRef.current,
                    buildChartFilename('funding-runway', activeData.updated, 'png')
                  )
                }
                actionsDisabled={!hasGrantYears}
                detail={
                  grantYearDetail ? (
                    <ChartDetail
                      title={grantYearDetail.title}
                      lines={grantYearDetail.lines}
                      onClear={() => clearSelection('grantYear')}
                    />
                  ) : null
                }
              >
                {hasGrantYears ? (
                  <BarChart
                    id={{ name: 'grant-years', ref: grantFundingRef }}
                    data={grantYearData}
                    ariaLabel="Grant totals by fiscal year"
                    valueFormatter={hasGrantAmounts ? formatCompactCurrency : formatCompactNumber}
                    onSelect={handleSelectGrantYear}
                    selectedLabel={chartSelections.grantYear?.label}
                  />
                ) : (
                  <div className="chart-empty">No grant year data available.</div>
                )}
              </ChartCard>
              <ChartCard
                title="Grant Type Mix"
                subtitle="Distribution of award activity codes"
                onDownloadSvg={() =>
                  downloadSvg(
                    grantTypeRef.current,
                    buildChartFilename('grant-type-mix', activeData.updated, 'svg')
                  )
                }
                onDownloadPng={() =>
                  downloadPng(
                    grantTypeRef.current,
                    buildChartFilename('grant-type-mix', activeData.updated, 'png')
                  )
                }
                actionsDisabled={!hasGrantTypes}
                legend={
                  hasGrantTypes ? (
                    <ChartLegend
                      segments={grantTypeSegments}
                      total={grantTypeTotal}
                      hiddenMap={hiddenGrantTypes}
                      onToggle={toggleHiddenGrantTypes}
                    />
                  ) : null
                }
                detail={
                  grantTypeDetail ? (
                    <ChartDetail
                      title={grantTypeDetail.title}
                      lines={grantTypeDetail.lines}
                      onClear={() => clearSelection('grantType')}
                    />
                  ) : null
                }
              >
                {hasGrantTypes ? (
                  <DonutChart
                    id={{ name: 'grant-types', ref: grantTypeRef }}
                    segments={visibleGrantTypeSegments}
                    centerLabel="Total grants"
                    centerValue={formatCompactNumber(visibleGrantTypeTotal)}
                    ariaLabel="Grant type distribution"
                    onSelect={handleSelectGrantType}
                    selectedLabel={chartSelections.grantType?.label}
                  />
                ) : (
                  <div className="chart-empty">
                    {grantTypesAllHidden
                      ? 'All segments hidden. Toggle a legend item to show data.'
                      : 'No grant type data available.'}
                  </div>
                )}
              </ChartCard>
              <ChartCard
                title="Top Funded Faculty"
                subtitle="Highest totals in the current view"
                onDownloadSvg={() =>
                  downloadSvg(
                    grantTopRef.current,
                    buildChartFilename('top-funded-faculty', activeData.updated, 'svg')
                  )
                }
                onDownloadPng={() =>
                  downloadPng(
                    grantTopRef.current,
                    buildChartFilename('top-funded-faculty', activeData.updated, 'png')
                  )
                }
                actionsDisabled={!hasGrantTop}
                detail={
                  grantTopDetail ? (
                    <ChartDetail
                      title={grantTopDetail.title}
                      lines={grantTopDetail.lines}
                      onClear={() => clearSelection('grantTop')}
                    />
                  ) : null
                }
              >
                {hasGrantTop ? (
                  <BarChart
                    id={{ name: 'grant-top', ref: grantTopRef }}
                    data={topGrantFaculty}
                    ariaLabel="Top funded faculty"
                    valueFormatter={hasGrantAmounts ? formatCompactCurrency : formatCompactNumber}
                    labelFormatter={(label) => truncateLabel(label, 8)}
                    onSelect={handleSelectTopFaculty}
                    selectedLabel={chartSelections.grantTop?.label}
                  />
                ) : (
                  <div className="chart-empty">No grant totals available yet.</div>
                )}
              </ChartCard>
            </>
          )}
        </div>
      </section>

      {openMember ? (
        <div
          className={`sticky-author ${stickyActive ? 'is-active' : ''}`}
          ref={stickyRef}
        >
          <div className="sticky-author-card">
            <div className="sticky-author-main">
              <span className="sticky-author-name">{openMember.name}</span>
              <span className="sticky-author-meta">{openMember.department}</span>
            </div>
            <span className="sticky-author-count">
              {isPublications
                ? `${openMember.filteredPublications.length} publications`
                : `${openMember.grantCount} grants`}
            </span>
          </div>
        </div>
      ) : null}

      {isPublications ? (
        <>
          <section
            className="table-wrap"
            id="tab-panel-publications"
            role="tabpanel"
            aria-labelledby="tab-publications"
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Faculty</th>
                  <th>Affiliation</th>
                  <th>Programs</th>
                  <th>Trend</th>
                  <th className="num">Publications</th>
                  <th className="num">Latest Year</th>
                  <th>First/Last</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredPublications.map((member) => {
                  const latestYear = Math.max(
                    ...member.filteredPublications.map((pub) => pub.year)
                  );
                  const yearSeries = buildYearSeries(
                    member.filteredPublications,
                    activeYearRange
                  );
                  const sparkMax = Math.max(
                    ...yearSeries.map((entry) => entry.count),
                    1
                  );
                  const authorCounts = getAuthorCounts(
                    member,
                    member.filteredPublications
                  );
                  const isOpen = openId === member.id;

                  return (
                    <Fragment key={member.id}>
                      <tr id={`faculty-${member.id}`}>
                        <td>
                          <div className="name-row">
                            <div className="name">{member.name}</div>
                            <button
                              type="button"
                              className="copy-link"
                              onClick={() => handleCopyLink(member)}
                              aria-label={`Copy link for ${member.name}`}
                              title="Copy link"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 5" />
                                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L14 19" />
                              </svg>
                            </button>
                            {copiedId === member.id ? (
                              <span className="muted small">Copied</span>
                            ) : null}
                          </div>
                          <div className="muted small">
                            {member.orcid ? (
                              <a
                                href={`https://orcid.org/${member.orcid}`}
                                target="_blank"
                                rel="noreferrer"
                                className="mono"
                              >
                                {member.orcid}
                              </a>
                            ) : (
                              'ORCID not listed'
                            )}
                          </div>
                        </td>
                        <td>{member.department}</td>
                        <td>
                          {member.programs?.length ? (
                            <div className="program-list">
                              {member.programs.map((program) => {
                                const isActive = programFilters.includes(program);
                                return (
                                  <button
                                    key={`${member.id}-${program}`}
                                    type="button"
                                    className={`program-pill ${
                                      isActive ? 'is-active' : ''
                                    }`}
                                    onClick={() => toggleProgramFilter(program)}
                                    aria-pressed={isActive}
                                    title={`Filter by ${program}`}
                                  >
                                    {program}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {yearSeries.length ? (
                            <div
                              className="sparkline"
                              role="img"
                              aria-label={formatSparklineLabel(yearSeries)}
                            >
                              {yearSeries.map((entry) => (
                                <span
                                  key={entry.year}
                                  className={`spark-bar ${
                                    entry.count ? 'is-active' : ''
                                  }`}
                                  style={{
                                    height: `${(entry.count / sparkMax) * 100}%`
                                  }}
                                  title={`${entry.year}: ${entry.count}`}
                                />
                              ))}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                          {yearSeries.length ? (
                            <div className="sparkline-range">
                              <span>{yearSeries[0].year}</span>
                              <span>{yearSeries[yearSeries.length - 1].year}</span>
                            </div>
                          ) : null}
                        </td>
                        <td className="num">{member.filteredPublications.length}</td>
                        <td className="num">{latestYear}</td>
                        <td>
                          {authorCounts ? (
                            <div
                              className="author-counts"
                              title={
                                Number.isFinite(authorCounts.known)
                                  ? `Authorship positions known for ${authorCounts.known} of ${authorCounts.total} publications.`
                                  : undefined
                              }
                            >
                              <span>
                                <strong>{authorCounts.first ?? 0}</strong> first
                              </span>
                              <span>
                                <strong>{authorCounts.last ?? 0}</strong> last
                              </span>
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pub-toggle"
                            aria-expanded={isOpen}
                            aria-controls={`pub-list-${member.id}`}
                            onClick={() => {
                              setOpenId(isOpen ? null : member.id);
                            }}
                          >
                            {isOpen ? 'Hide list' : 'View list'}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="pub-row">
                          <td colSpan={8}>
                            <div className="pub-table-wrap" id={`pub-list-${member.id}`}>
                              <div className="pub-table">
                                <div className="pub-grid pub-header">
                                  <span className="pub-head pub-head-pmid">PMID</span>
                                  <span className="pub-head pub-head-year">Year</span>
                                  <span className="pub-head pub-head-authorship">Authorship</span>
                                  <span className="pub-head">Journal</span>
                                  <span className="pub-head">Title</span>
                                  <span className="pub-head pub-head-doi">DOI</span>
                                </div>
                                {member.filteredPublications.map((pub) => {
                                  const authorship = formatAuthorshipLabel(pub.authorship);
                                  return (
                                    <div className="pub-grid" key={pub.id}>
                                      <div className="pub-cell mono pub-pmid">
                                        {pub.url ? (
                                          <a
                                            href={pub.url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {pub.id}
                                          </a>
                                        ) : (
                                          pub.id
                                        )}
                                      </div>
                                      <div className="pub-cell num pub-year">
                                        {pub.year ?? '—'}
                                      </div>
                                      <div
                                        className={`pub-cell pub-authorship ${
                                          authorship.isKnown ? '' : 'muted'
                                        }`}
                                        title={authorship.title}
                                      >
                                        {authorship.label}
                                      </div>
                                      <div className="pub-cell">{pub.journal}</div>
                                      <div className="pub-cell pub-title-cell">
                                        {pub.url ? (
                                          <a
                                            href={pub.url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {pub.title}
                                          </a>
                                        ) : (
                                          pub.title
                                        )}
                                      </div>
                                      <div className="pub-cell pub-doi">
                                        {pub.doi ? (
                                          <a
                                            href={`https://doi.org/${pub.doi}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="doi-link"
                                            aria-label={`Open DOI ${pub.doi}`}
                                          >
                                            DOI
                                          </a>
                                        ) : (
                                          '—'
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          {filteredPublications.length === 0 ? (
            <section className="empty">
              <h2>No results found</h2>
              <p>Try adjusting the search term or widening the year range.</p>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section
            className="table-wrap"
            id="tab-panel-grants"
            role="tabpanel"
            aria-labelledby="tab-grants"
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Faculty</th>
                  <th>Affiliation</th>
                  <th>Programs</th>
                  <th>Grant Type</th>
                  <th className="num">Grants</th>
                  <th className="num">Total Awarded</th>
                  <th>Latest End</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredGrants.map((member) => {
                  const latestEnd = member.groupedGrants.reduce((latest, grant) => {
                    const end = grant.latestEnd || '';
                    return end > latest ? end : latest;
                  }, '');
                  const isOpen = openId === member.id;

                  return (
                    <Fragment key={member.id}>
                      <tr id={`faculty-${member.id}`}>
                        <td>
                          <div className="name-row">
                            <div className="name">{member.name}</div>
                            <button
                              type="button"
                              className="copy-link"
                              onClick={() => handleCopyLink(member)}
                              aria-label={`Copy link for ${member.name}`}
                              title="Copy link"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 5" />
                                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L14 19" />
                              </svg>
                            </button>
                            {copiedId === member.id ? (
                              <span className="muted small">Copied</span>
                            ) : null}
                          </div>
                        </td>
                        <td>{member.department}</td>
                        <td>
                          {member.programs?.length ? (
                            <div className="program-list">
                              {member.programs.map((program) => {
                                const isActive = programFilters.includes(program);
                                return (
                                  <button
                                    key={`${member.id}-${program}`}
                                    type="button"
                                    className={`program-pill ${
                                      isActive ? 'is-active' : ''
                                    }`}
                                    onClick={() => toggleProgramFilter(program)}
                                    aria-pressed={isActive}
                                    title={`Filter by ${program}`}
                                  >
                                    {program}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {member.grantTypes?.length ? (
                            <div className="program-list">
                              {member.grantTypes.map((type) => {
                                const isActive = grantTypeFilters.includes(type);
                                return (
                                  <button
                                    key={`${member.id}-${type}`}
                                    type="button"
                                    className={`program-pill ${isActive ? 'is-active' : ''}`}
                                    onClick={() => toggleGrantTypeFilter(type)}
                                    aria-pressed={isActive}
                                    title={`Filter by ${type}`}
                                  >
                                    {type}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">{member.grantCount}</td>
                        <td className="num">
                          {member.hasAmount ? formatCurrency(member.totalAmount) : '—'}
                        </td>
                        <td>{latestEnd ? formatDate(latestEnd) : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="pub-toggle"
                            aria-expanded={isOpen}
                            aria-controls={`grant-list-${member.id}`}
                            onClick={() => {
                              setOpenId(isOpen ? null : member.id);
                            }}
                          >
                            {isOpen ? 'Hide list' : 'View list'}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="grant-row">
                          <td colSpan={8}>
                            <div
                              className="grant-table-wrap"
                              id={`grant-list-${member.id}`}
                            >
                              <div className="grant-table">
                                <div className="grant-grid grant-header">
                                  <span className="grant-head grant-head-number">
                                    Grant #
                                  </span>
                                  <span className="grant-head grant-head-type">
                                    Type
                                  </span>
                                  <span className="grant-head grant-head-role">Role</span>
                                  <span className="grant-head grant-head-amount">Award</span>
                                  <span className="grant-head grant-head-start">Start</span>
                                  <span className="grant-head grant-head-end">End</span>
                                  <span className="grant-head">Project title</span>
                                </div>
                                {member.groupedGrants.map((group) => (
                                  <Fragment key={group.coreNumber}>
                                    <div className="grant-group">
                                      <div className="grant-group-title">
                                        <span className="mono">{group.coreNumber}</span>
                                        {group.title ? (
                                          <span className="grant-group-title-text">
                                            — {group.title}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="grant-group-meta">
                                        {group.awards.length} awards
                                        {group.totalAmount
                                          ? ` • ${formatCurrency(group.totalAmount)}`
                                          : ''}
                                      </div>
                                    </div>
                                    {group.awards.map((grant) => (
                                      <div
                                        className="grant-grid"
                                        key={`${group.coreNumber}-${grant.id}-${grant.fiscalYear || ''}`}
                                      >
                                        <div className="grant-cell mono grant-number">
                                          {grant.url ? (
                                            <a
                                              href={grant.url}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              {grant.id || '—'}
                                            </a>
                                          ) : (
                                            grant.id || '—'
                                          )}
                                        </div>
                                        <div className="grant-cell grant-type">
                                          {group.type || '—'}
                                        </div>
                                        <div className="grant-cell grant-role">
                                          {grant.role || '—'}
                                        </div>
                                        <div className="grant-cell num grant-amount">
                                          {formatCurrency(grant.amount)}
                                        </div>
                                        <div className="grant-cell num grant-date">
                                          {formatDate(grant.startDate)}
                                        </div>
                                        <div className="grant-cell num grant-date">
                                          {formatDate(grant.endDate)}
                                        </div>
                                        <div className="grant-cell grant-title">
                                          {grant.title || '—'}
                                        </div>
                                      </div>
                                    ))}
                                  </Fragment>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          {filteredGrants.length === 0 ? (
            <section className="empty">
              <h2>No results found</h2>
              <p>Try adjusting the search term or clearing filters.</p>
            </section>
          ) : null}
        </>
      )}

      <footer className="footer">
        <p>
          Built for CTSI faculty reporting. Update the dataset in
          <span className="mono"> {activeFile}</span> to refresh the dashboard.
        </p>
      </footer>
    </main>
  );
}
