const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');

const emitter = new EventEmitter();
const queue = [];
const activeWorkers = new Map();
let timer = null;

function getQueueStats() {
  return {
    queued: queue.filter((job) => job.status === 'queued').length,
    processing: queue.filter((job) => job.status === 'processing').length,
    done: queue.filter((job) => job.status === 'done').length,
    total: queue.length,
    jobs: [...queue]
  };
}

function spawnWorkerForJob(job) {
  const workerScript = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { job } = workerData;

    const start = Date.now();
    const run = async () => {
      const simulatedDelayMs = Number(job.delayMs || 900);
      await new Promise((resolve) => setTimeout(resolve, simulatedDelayMs));

      const result = {
        id: job.id,
        type: job.type,
        subject: job.subject,
        recipient: job.recipient,
        data: job.data || {},
        status: 'done',
        startedAt: new Date().toISOString(),
        processingMs: Date.now() - start,
        simulatedBy: 'worker_threads'
      };

      parentPort.postMessage({ type: 'job:done', payload: result });
    };

    run().catch((error) => {
      parentPort.postMessage({
        type: 'job:error',
        payload: {
          id: job.id,
          error: error.message || 'Worker processing failed'
        }
      });
    });
  `;

  const worker = new Worker(workerScript, {
    eval: true,
    workerData: { job }
  });

  worker.on('message', (message) => {
    if (!message || !message.type) return;

    const target = queue.find((item) => item.id === job.id);
    if (!target) return;

    if (message.type === 'job:done') {
      target.status = 'done';
      target.completedAt = new Date().toISOString();
      target.result = message.payload;
      emitter.emit('job:done', target);
    }

    if (message.type === 'job:error') {
      target.status = 'failed';
      target.error = message.payload?.error || 'Unknown worker error';
      emitter.emit('job:error', target);
    }
  });

  worker.on('error', (error) => {
    const target = queue.find((item) => item.id === job.id);
    if (!target) return;
    target.status = 'failed';
    target.error = error.message;
    emitter.emit('job:error', target);
  });

  worker.on('exit', (code) => {
    activeWorkers.delete(job.id);
    if (code !== 0) {
      const target = queue.find((item) => item.id === job.id);
      if (target) {
        target.status = 'failed';
        target.error = `Worker exited with code ${code}`;
      }
    }
  });

  activeWorkers.set(job.id, worker);
  return worker;
}

function enqueueJob(job = {}) {
  const record = {
    id: job.id || `job_${crypto.randomUUID()}`,
    type: job.type || 'notification',
    subject: job.subject || 'ApexFlow job',
    recipient: job.recipient || 'system',
    message: job.message || 'Sin detalle',
    data: job.data || {},
    status: 'queued',
    createdAt: new Date().toISOString(),
    delayMs: Number(job.delayMs || 900)
  };

  queue.push(record);
  emitter.emit('job:queued', record);

  record.status = 'processing';
  spawnWorkerForJob(record);

  return record;
}

function startWorker({ pollIntervalMs = 500 } = {}) {
  if (timer) return { queue, activeWorkers, getQueueStats };

  timer = setInterval(() => {
    const pending = queue.filter((item) => item.status === 'queued');
    if (pending.length === 0) return;

    pending.forEach((job) => {
      if (!activeWorkers.has(job.id) && job.status !== 'done') {
        job.status = 'processing';
        spawnWorkerForJob(job);
      }
    });
  }, pollIntervalMs);

  return { queue, activeWorkers, getQueueStats };
}

function stopWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  for (const worker of activeWorkers.values()) {
    worker.terminate();
  }
  activeWorkers.clear();
}

function processJob(job) {
  return enqueueJob(job);
}

function drainQueue() {
  const pending = queue.filter((item) => item.status === 'queued');
  pending.forEach((job) => {
    job.status = 'processing';
    spawnWorkerForJob(job);
  });
  return pending;
}

const getJobStats = () => getQueueStats();

module.exports = {
  emitter,
  queue,
  activeWorkers,
  enqueueJob,
  processJob,
  drainQueue,
  startWorker,
  stopWorker,
  getQueueStats,
  getJobStats,
  spawnWorkerForJob
};
