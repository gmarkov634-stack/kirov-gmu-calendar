import crypto from 'node:crypto';
import https from 'node:https';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['igma.ru', 'www.igma.ru']);
const MAX_REDIRECTS = 5;

export const IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY = Object.freeze({
  scope: 'source_local',
  communicationSkillsStatus: 'unresolved',
  reason: 'official_izhgmu_pages_use_different_stream_group_partitions_for_different_course_6_electives',
  evidence: Object.freeze([
    Object.freeze({
      url: 'https://www.igma.ru/component/content/category/71-klinicheskoj-biokhimii-fpk',
      observed: 'ДВ-5: I поток 601-616; II поток 617-630',
    }),
    Object.freeze({
      url: 'https://www.igma.ru/component/content/category/71-klinicheskoj-biokhimii-fpk?Itemid=108',
      observed: 'Другой ДВ-5: поток №1 группы 601-606, 607-612; поток №2 группы 613-618, 619-624',
    }),
  ]),
});

export const IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES = Object.freeze([
  Object.freeze({
    id: 'medicine6-intermediate-attestation-2026',
    kind: 'intermediate_attestation_schedule',
    faculty: 'medicine',
    course: 6,
    academicYear: '2025-2026',
    sourcePageUrl: 'https://www.igma.ru/index.php?Itemid=185&catid=11%3Afakultety&id=15%3Alechebnyj-fakultet&option=com_content&view=article',
    linkLabel: '6 курс',
    url: 'https://www.igma.ru/images/avtors/lechfak/6_%D0%BA%D1%83%D1%80%D1%81_%D0%BB%D0%B5%D1%82%D0%BE_2026.pdf',
    outputFile: 'medicine6-intermediate-attestation-2026.pdf',
    calendarAuthority: 'exact_schedule_required',
    rangeMarkerFallback: false,
  }),
  Object.freeze({
    id: 'medicine6-gia-2026',
    kind: 'gia_schedule',
    faculty: 'medicine',
    course: 6,
    academicYear: '2025-2026',
    sourcePageUrl: 'https://www.igma.ru/index.php?Itemid=185&catid=11%3Afakultety&id=15%3Alechebnyj-fakultet&option=com_content&view=article',
    linkLabel: 'Расписание государственных экзаменов ГИА 6 курс',
    url: 'https://www.igma.ru/images/avtors/lechfak/%D0%9F%D1%80%D0%B8%D0%BA%D0%B0%D0%B7_206_07-02_%D0%BE%D1%82_14.05.2026__%D0%9E%D0%B1_%D1%83%D1%82%D0%B2%D0%B5%D1%80%D0%B6%D0%B4%D0%B5%D0%BD%D0%B8%D0%B8_%D1%80%D0%B0%D1%81%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D1%8F_%D0%B3%D0%BE%D1%81%D1%83%D0%B4%D0%B0%D1%80%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BD%D0%BE%D0%B9_%D0%B8%D1%82%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D0%B9_%D0%B0%D1%82%D1%82%D0%B5%D1%81%D1%82%D0%B0%D1%86%D0%B8_11909v2_.pdf',
    outputFile: 'medicine6-gia-2026.pdf',
    calendarAuthority: 'exact_schedule_required',
    rangeMarkerFallback: false,
  }),
]);

function assertOfficialPdfUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    const error = new Error(`Unsupported IzhGMU post-semester source URL: ${url.href}`);
    error.code = 'IZH_POSTSEMESTER_URL_REJECTED';
    throw error;
  }
  if (!/\.pdf$/i.test(url.pathname)) {
    const error = new Error(`IzhGMU post-semester source is not a PDF URL: ${url.href}`);
    error.code = 'IZH_POSTSEMESTER_PDF_URL_REQUIRED';
    throw error;
  }
  return url;
}

export function canonicalOfficialPdfUrl(rawUrl) {
  const url = assertOfficialPdfUrl(rawUrl);
  if (url.hostname.toLowerCase() === 'igma.ru') url.hostname = 'www.igma.ru';
  return url;
}

export function resolveOfficialPdfRedirect(currentUrl, location) {
  const base = assertOfficialPdfUrl(currentUrl);
  return assertOfficialPdfUrl(new URL(location, base).href);
}

function isPdf(buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function nodeHttpsGet(url, {
  timeoutMs,
  maxBytes,
  redirectCount = 0,
  redirectHistory = [],
} = {}) {
  const currentUrl = redirectCount === 0
    ? canonicalOfficialPdfUrl(url)
    : assertOfficialPdfUrl(url);
  const currentHref = currentUrl.href;
  if (redirectHistory.includes(currentHref)) {
    const error = new Error(`IzhGMU post-semester redirect loop detected: ${currentHref}`);
    error.code = 'IZH_POSTSEMESTER_REDIRECT_LOOP';
    throw error;
  }
  const nextHistory = [...redirectHistory, currentHref];

  return new Promise((resolve, reject) => {
    const request = https.get(currentUrl, {
      family: 4,
      headers: {
        'User-Agent': 'MedicalUniversityCalendarBot/1.0 (+IzhGMU post-semester schedule download)',
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
        'Accept-Encoding': 'identity',
      },
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          const error = new Error(`IzhGMU post-semester redirect limit exceeded: ${currentHref}`);
          error.code = 'IZH_POSTSEMESTER_REDIRECT_LIMIT';
          reject(error);
          return;
        }
        let nextUrl;
        try {
          nextUrl = resolveOfficialPdfRedirect(currentUrl, location);
        } catch (error) {
          reject(error);
          return;
        }
        nodeHttpsGet(nextUrl, {
          timeoutMs,
          maxBytes,
          redirectCount: redirectCount + 1,
          redirectHistory: nextHistory,
        }).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        const error = new Error(`IzhGMU post-semester source HTTP ${status || 'unknown'}: ${currentHref}`);
        error.code = 'IZH_POSTSEMESTER_HTTP_ERROR';
        error.status = status || null;
        reject(error);
        return;
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > maxBytes) {
        response.destroy();
        const error = new Error(`IzhGMU post-semester PDF exceeds ${maxBytes} bytes`);
        error.code = 'IZH_POSTSEMESTER_TOO_LARGE';
        reject(error);
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          const error = new Error(`IzhGMU post-semester PDF exceeds ${maxBytes} bytes`);
          error.code = 'IZH_POSTSEMESTER_TOO_LARGE';
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          finalUrl: currentHref,
          contentType: response.headers['content-type'] || null,
        });
      });
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error(`IzhGMU post-semester request timed out: ${currentHref}`);
      error.code = 'IZH_POSTSEMESTER_TIMEOUT';
      request.destroy(error);
    });
    request.on('error', (cause) => {
      if (cause?.code?.startsWith?.('IZH_')) {
        reject(cause);
        return;
      }
      const error = new Error(`IzhGMU post-semester network error: ${cause?.code || cause?.message || 'unknown'}`);
      error.code = 'IZH_POSTSEMESTER_NETWORK_ERROR';
      error.causeCode = cause?.code || null;
      reject(error);
    });
  });
}

async function fetchWithInjectedClient(url, fetchImpl, { timeoutMs, maxBytes }) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'kirov-gmu-calendar/izhgmu-postsemester-source-boundary',
      accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
    },
  });
  if (!response?.ok) {
    const error = new Error(`IzhGMU post-semester source HTTP ${response?.status ?? 'unknown'}: ${url.href}`);
    error.code = 'IZH_POSTSEMESTER_HTTP_ERROR';
    error.status = response?.status ?? null;
    throw error;
  }
  const finalUrl = assertOfficialPdfUrl(response.url || url.href);
  const lengthHeader = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes) {
    const error = new Error(`IzhGMU post-semester PDF exceeds ${maxBytes} bytes`);
    error.code = 'IZH_POSTSEMESTER_TOO_LARGE';
    throw error;
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    finalUrl: finalUrl.href,
    contentType: response.headers?.get?.('content-type') || null,
  };
}

export async function fetchIzhgmuPostsemesterSource(source, {
  fetchImpl = null,
  timeoutMs = 30_000,
  maxBytes = MAX_PDF_BYTES,
} = {}) {
  if (fetchImpl != null && typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const url = canonicalOfficialPdfUrl(source?.url);
  const response = fetchImpl
    ? await fetchWithInjectedClient(url, fetchImpl, { timeoutMs, maxBytes })
    : await nodeHttpsGet(url, { timeoutMs, maxBytes });
  const buffer = response.buffer;
  if (buffer.length === 0 || buffer.length > maxBytes) {
    const error = new Error(`IzhGMU post-semester PDF size is invalid: ${buffer.length}`);
    error.code = 'IZH_POSTSEMESTER_TOO_LARGE';
    throw error;
  }
  if (!isPdf(buffer)) {
    const error = new Error(`IzhGMU post-semester source did not return PDF bytes: ${url.href}`);
    error.code = 'IZH_POSTSEMESTER_NOT_PDF';
    throw error;
  }
  return {
    source: { ...source, url: url.href, finalUrl: response.finalUrl },
    buffer,
    bytes: buffer.length,
    sha256: sha256(buffer),
    contentType: response.contentType,
  };
}

export async function collectIzhgmuMedicine6PostsemesterSources(options = {}) {
  const files = [];
  for (const source of IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES) {
    try {
      const result = await fetchIzhgmuPostsemesterSource(source, options);
      files.push({
        id: source.id,
        kind: source.kind,
        outputFile: source.outputFile,
        sourcePageUrl: source.sourcePageUrl,
        url: result.source.url,
        finalUrl: result.source.finalUrl,
        status: 'downloaded',
        bytes: result.bytes,
        sha256: result.sha256,
        contentType: result.contentType,
        calendarAuthority: source.calendarAuthority,
        rangeMarkerFallback: source.rangeMarkerFallback,
        buffer: result.buffer,
      });
    } catch (error) {
      files.push({
        id: source.id,
        kind: source.kind,
        outputFile: source.outputFile,
        sourcePageUrl: source.sourcePageUrl,
        url: source.url,
        status: 'failed',
        error: error?.code || 'fetch_error',
        message: error?.message || String(error),
        causeCode: error?.causeCode || null,
        calendarAuthority: source.calendarAuthority,
        rangeMarkerFallback: source.rangeMarkerFallback,
        buffer: null,
      });
    }
  }
  const downloadedCount = files.filter((item) => item.status === 'downloaded').length;
  return {
    sourcePageUrl: IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES[0].sourcePageUrl,
    expectedCount: IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES.length,
    downloadedCount,
    failedCount: files.length - downloadedCount,
    status: downloadedCount === files.length ? 'ok' : 'needs_review',
    streamMappingPolicy: IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY,
    files,
  };
}
