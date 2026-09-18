const DEFAULT_URL = process.env.APEXFLOW_URL || process.argv[2] || 'http://localhost:3000';
const TOTAL_REQUESTS = Number(process.env.BENCHMARK_REQUESTS || 100);
const CONCURRENCY = Number(process.env.BENCHMARK_CONCURRENCY || 10);
const LOGIN = {
  email: process.env.APEXFLOW_EMAIL || 'admin@apexflow.com',
  password: process.env.APEXFLOW_PASSWORD || 'admin123'
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message = payload.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function getToken(baseUrl) {
  const loginResponse = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify(LOGIN)
  });

  if (!loginResponse.token) {
    throw new Error('La autenticación no devolvió un JWT válido.');
  }

  return loginResponse.token;
}

async function measureOneRequest(baseUrl, token) {
  const start = Date.now();
  await fetchJson(`${baseUrl}/api/metrics`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return Date.now() - start;
}

async function runBenchmark(baseUrl) {
  const token = await getToken(baseUrl);
  const timings = [];
  const errors = [];

  for (let offset = 0; offset < TOTAL_REQUESTS; offset += CONCURRENCY) {
    const batchSize = Math.min(CONCURRENCY, TOTAL_REQUESTS - offset);
    const batch = Array.from({ length: batchSize }, () => measureOneRequest(baseUrl, token).catch((error) => {
      errors.push(error.message);
      return null;
    }));

    const batchResults = await Promise.all(batch);
    batchResults.forEach((value) => {
      if (value !== null) timings.push(value);
    });
  }

  const successCount = timings.length;
  const totalCount = TOTAL_REQUESTS;
  const avg = timings.reduce((sum, value) => sum + value, 0) / (successCount || 1);
  const min = timings.length ? Math.min(...timings) : 0;
  const max = timings.length ? Math.max(...timings) : 0;
  const p95 = percentile(timings, 95);

  console.log('');
  console.log('ApexFlow Distributed - Benchmark');
  console.log('================================');
  console.log(`Target: ${baseUrl}`);
  console.log(`Requests: ${totalCount}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Successful responses: ${successCount}`);
  console.log(`Failed responses: ${totalCount - successCount}`);
  console.log(`Average latency: ${avg.toFixed(2)} ms`);
  console.log(`Min latency: ${min} ms`);
  console.log(`Max latency: ${max} ms`);
  console.log(`p95 latency: ${p95} ms`);
  console.log(`Success rate: ${((successCount / totalCount) * 100 || 0).toFixed(2)}%`);

  if (errors.length) {
    console.log('');
    console.log('Sample errors:');
    errors.slice(0, 5).forEach((message) => console.log(`- ${message}`));
  }
}

async function main() {
  try {
    await runBenchmark(DEFAULT_URL);
  } catch (error) {
    console.error('');
    console.error('Benchmark failed.');
    console.error(error.message);
    console.error('');
    console.error('Use: node tests/benchmark.js http://localhost:3000');
    process.exit(1);
  }
}

main();
