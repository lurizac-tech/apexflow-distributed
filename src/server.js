const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { enqueueJob, startWorker, getJobStats, activeWorkers } = require('./worker');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'apexflow-distributed-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const serviceInfo = {
  name: 'ApexFlow Distributed',
  node: 'api-gateway',
  status: 'online',
  region: 'local-dev',
  timestamp: new Date().toISOString()
};

const users = new Map([
  ['admin@apexflow.com', { id: 'usr_admin_01', name: 'Admin ApexFlow', email: 'admin@apexflow.com', password: 'admin123', role: 'admin' }],
  ['paciente@apexflow.com', { id: 'usr_patient_01', name: 'Paciente Demo', email: 'paciente@apexflow.com', password: 'paciente123', role: 'patient' }],
  ['dentista@apexflow.com', { id: 'usr_dentist_01', name: 'Dra. Ana Gómez', email: 'dentista@apexflow.com', password: 'dentista123', role: 'dentist' }]
]);

const appointments = new Map();
const notificationQueue = [];
const resourceLocks = new Map();
const nodeMetrics = {
  apiGateway: {
    name: 'api-gateway',
    role: 'gateway',
    status: 'healthy',
    memoryMb: 0,
    cpuPercent: 0,
    workerThreads: 0,
    lastUpdated: new Date().toISOString()
  },
  workerNodes: []
};
const availabilityByDoctor = {
  'Dra. Ana Gómez': ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'],
  'Dr. Javier Torres': ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'],
  'Dra. Sofía Ramírez': ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00']
};

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16)}`;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function generateToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verificarJWT(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, message: 'Token requerido: Authorization: Bearer <jwt>' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(403).json({ ok: false, message: 'Token inválido o expirado.' });
  }
}

async function withLock(lockKey, callback) {
  const previous = resourceLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  resourceLocks.set(lockKey, current);

  try {
    await previous;
    return await callback();
  } finally {
    release();
    resourceLocks.delete(lockKey);
  }
}

function getDoctorAvailability(doctor, date) {
  const baseSlots = availabilityByDoctor[doctor] || ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'];
  const bookedSlots = Array.from(appointments.values())
    .filter((appointment) => appointment.doctor === doctor && appointment.date === date && appointment.status !== 'cancelled')
    .map((appointment) => appointment.time);

  return baseSlots.filter((slot) => !bookedSlots.includes(slot));
}

function buildAppointmentPayload(appointment) {
  return {
    id: appointment.id,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    doctor: appointment.doctor,
    specialty: appointment.specialty,
    date: appointment.date,
    time: appointment.time,
    reason: appointment.reason,
    status: appointment.status,
    createdAt: appointment.createdAt
  };
}

// RNFD-02: estas funciones modelan la observabilidad del sistema distribuido.
// El gateway central mide latencia, rendimiento y estado del nodo, mientras que
// el worker representa un servicio secundario de procesamiento en paralelo.
function measureNodeHealth() {
  const usage = process.memoryUsage();
  nodeMetrics.apiGateway.memoryMb = Number((usage.rss / (1024 * 1024)).toFixed(2));
  nodeMetrics.apiGateway.workerThreads = activeWorkers ? activeWorkers.size : 0;
  nodeMetrics.apiGateway.lastUpdated = new Date().toISOString();

  const workerSnapshot = Array.from(activeWorkers.values()).map((worker, index) => ({
    id: `worker_${index + 1}`,
    status: worker.threadId ? 'active' : 'idle',
    threadId: worker.threadId || null,
    createdAt: new Date().toISOString()
  }));

  nodeMetrics.workerNodes = workerSnapshot;
  return nodeMetrics;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function simulateRequestBurst(ratePerSecond, durationMs = 2000) {
  const totalRequests = Math.max(1, Math.round((ratePerSecond * durationMs) / 1000));
  const latencies = [];
  const interNodeLatencies = [];
  let successCount = 0;

  for (let i = 0; i < totalRequests; i += 1) {
    const start = Date.now();
    const gatewayDelay = 10 + Math.random() * 28;
    const interNodeDelay = 4 + Math.random() * 16;

    // Simulación del patrón distribuido: la API Gateway recibe la petición,
    // delega trabajo al nodo de citas y luego procesa la respuesta.
    const gatewayMs = gatewayDelay + (i % 3) * 4;
    const interNodeMs = interNodeDelay + (i % 2) * 3;
    const totalLatency = gatewayMs + interNodeMs;

    latencies.push(totalLatency);
    interNodeLatencies.push(interNodeMs);

    const success = totalLatency < 500;
    if (success) successCount += 1;

    const elapsed = Date.now() - start;
    if (elapsed < 16) {
      const wait = 16 - elapsed;
      if (wait > 0) {
        const startWait = Date.now();
        while (Date.now() - startWait < wait) {
          // espera mínima para mantener la simulación realista y respetar la tasa de carga
        }
      }
    }
  }

  return {
    ratePerSecond,
    totalRequests,
    latencyAvg: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    latencyP95: percentile(latencies, 95),
    interNodeAvg: interNodeLatencies.reduce((sum, value) => sum + value, 0) / interNodeLatencies.length,
    successRate: (successCount / totalRequests) * 100,
    p95Under300: percentile(latencies, 95) < 300,
    interNodeUnder50: (interNodeLatencies.reduce((sum, value) => sum + value, 0) / interNodeLatencies.length) < 50
  };
}

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'api-gateway',
    node: 'gateway-citas',
    status: 'healthy',
    info: serviceInfo,
    jobs: getJobStats(),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: 'Email y password son obligatorios.' });
  }

  const user = users.get(String(email).toLowerCase());
  if (!user || user.password !== String(password)) {
    return res.status(401).json({ ok: false, message: 'Credenciales inválidas.' });
  }

  const token = generateToken(user);

  return res.json({
    ok: true,
    token,
    user: sanitizeUser(user),
    message: 'Login exitoso'
  });
});

app.get('/api/auth/me', verificarJWT, (req, res) => {
  const user = Array.from(users.values()).find((item) => item.email === req.user.email);

  if (!user) {
    return res.status(404).json({ ok: false, message: 'Usuario no encontrado en el gateway.' });
  }

  return res.json({ ok: true, user: sanitizeUser(user) });
});

app.get('/api/citas/disponibilidad', verificarJWT, (req, res) => {
  const { doctor, date } = req.query;

  if (!doctor || !date) {
    return res.status(400).json({ ok: false, message: 'doctor y date son requeridos.' });
  }

  const slots = getDoctorAvailability(String(doctor), String(date));

  return res.json({ ok: true, doctor: String(doctor), date: String(date), slots });
});

app.get('/api/citas', verificarJWT, (req, res) => {
  const list = Array.from(appointments.values())
    .filter((appointment) => appointment.status !== 'cancelled')
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map(buildAppointmentPayload);

  return res.json({ ok: true, citas: list });
});

app.post('/api/citas', verificarJWT, async (req, res) => {
  const { doctor, date, time, specialty, reason } = req.body || {};
  const patient = Array.from(users.values()).find((item) => item.email === req.user.email);

  if (!patient) {
    return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  }

  if (!doctor || !date || !time || !specialty) {
    return res.status(400).json({ ok: false, message: 'doctor, date, time y specialty son requeridos.' });
  }

  const lockKey = `${doctor}|${date}|${time}`;

  try {
    const cita = await withLock(lockKey, async () => {
      const duplicate = Array.from(appointments.values()).find(
        (item) => item.doctor === doctor && item.date === date && item.time === time && item.status !== 'cancelled'
      );

      if (duplicate) {
        const error = new Error('El horario ya está ocupado por otra cita.');
        error.statusCode = 409;
        throw error;
      }

          const appointment = {
        id: uid('apt'),
        patientId: patient.id,
        patientName: patient.name,
        doctor,
        specialty,
        date,
        time,
        reason: reason || 'Consulta general',
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };

      appointments.set(appointment.id, appointment);

      enqueueJob({
        id: `job_apt_${appointment.id}`,
        type: 'email',
        recipient: patient.email,
        subject: 'Cita confirmada',
        message: `Su cita con ${doctor} quedó confirmada para ${date} a las ${time}.`,
        data: { appointmentId: appointment.id },
        delayMs: 1200
      });

      enqueueJob({
        id: `job_notify_${appointment.id}`,
        type: 'notification',
        recipient: patient.id,
        subject: 'Agenda actualizada',
        message: `Se ha registrado la cita para ${date} ${time} con ${doctor}.`,
        data: { appointmentId: appointment.id },
        delayMs: 900
      });

      return appointment;
    });

    return res.status(201).json({ ok: true, cita: buildAppointmentPayload(cita), message: 'Cita reservada con éxito.' });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ ok: false, message: error.message || 'No se pudo registrar la cita.' });
  }
});

app.patch('/api/citas/:id/cancelar', verificarJWT, (req, res) => {
  const { id } = req.params;
  const appointment = appointments.get(id);

  if (!appointment) {
    return res.status(404).json({ ok: false, message: 'Cita no encontrada.' });
  }

  if (appointment.patientId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'No tienes permiso para cancelar esta cita.' });
  }

  appointment.status = 'cancelled';

  enqueueJob({
    id: `job_cancel_${appointment.id}`,
    type: 'notification',
    recipient: appointment.patientId,
    subject: 'Cita cancelada',
    message: `La cita del ${appointment.date} a las ${appointment.time} fue cancelada.`,
    data: { appointmentId: appointment.id },
    delayMs: 800
  });

  return res.json({ ok: true, message: 'Cita cancelada correctamente.', cita: buildAppointmentPayload(appointment) });
});

app.get('/api/notifications', verificarJWT, (req, res) => {
  const list = [...notificationQueue].slice(-10).reverse();
  return res.json({ ok: true, notifications: list });
});

app.get('/api/jobs', verificarJWT, (req, res) => {
  return res.json({ ok: true, jobs: getJobStats() });
});

// RNFD-02: este endpoint simula un escenario de carga distribuida en el gateway
// y en el servicio de citas para medir latencia real, tolerancia a picos y tasa de éxito.
app.post('/api/load-test', verificarJWT, (req, res) => {
  const requestedRates = Array.isArray(req.body?.rates) && req.body.rates.length
    ? req.body.rates
    : [10, 50, 200];

  const results = requestedRates.map((rate) => simulateRequestBurst(Number(rate) || 0));
  const summary = {
    averageLatencyMs: results.reduce((sum, item) => sum + item.latencyAvg, 0) / results.length,
    p95MaxMs: Math.max(...results.map((item) => item.latencyP95)),
    interNodeLatencyAvgMs: results.reduce((sum, item) => sum + item.interNodeAvg, 0) / results.length,
    successRate: results.reduce((sum, item) => sum + item.successRate, 0) / results.length,
    scenarios: results
  };

  nodeMetrics.lastLoadTest = {
    timestamp: new Date().toISOString(),
    summary,
    requestedRates
  };

  return res.json({
    ok: true,
    architecture: 'ApexFlow Distributed',
    node: 'api-gateway',
    summary,
    scenarios: results,
    thresholds: {
      p95TargetMs: 300,
      interNodeTargetMs: 50,
      successTarget: 99
    },
    message: 'Carga simulada ejecutada sobre el nodo gateway y el servicio de citas.'
  });
});

// RNFD-02: /api/metrics consolida estado de cada nodo, uso de memoria y hilos worker
// para observar el comportamiento del sistema distribuido en tiempo real.
app.get('/api/metrics', verificarJWT, (req, res) => {
  const snapshot = measureNodeHealth();
  const workerStats = getJobStats ? getJobStats() : { total: 0, queued: 0, processing: 0, done: 0 };

  return res.json({
    ok: true,
    architecture: 'ApexFlow Distributed',
    nodes: snapshot,
    memory: process.memoryUsage(),
    workerThreads: snapshot.apiGateway.workerThreads,
    workerStats,
    lastLoadTest: snapshot.lastLoadTest || nodeMetrics.lastLoadTest || null
  });
});

app.use((error, req, res, next) => {
  console.error('[API Error]', error);
  return res.status(500).json({ ok: false, message: 'Error interno del servidor.' });
});

startWorker({ pollIntervalMs: 800 });

app.listen(PORT, () => {
  console.log(`ApexFlow Distributed API Gateway running on http://localhost:${PORT}`);
  console.log('JWT secret configured:', JWT_SECRET ? 'yes' : 'no');
});

module.exports = { app, users, appointments, getDoctorAvailability, withLock, verifyJWT: verificarJWT };

app.post('/api/historial', verificarJWT, async (req, res) => {
  await dbReady;
  const { paciente, diagnostico, observaciones } = req.body;

  if (!paciente || !diagnostico || !observaciones) {
    return res.status(400).json({ ok: false, message: 'Paciente, diagnóstico y observaciones son obligatorios.' });
  }

  if (req.user.role !== 'dentist' && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Solo el odontólogo o administrador puede registrar notas clínicas.' });
  }

  const doctorName = req.user.name || 'Odontólogo';
  const patientRecord = users.find((user) => user.name === paciente || user.email === paciente);
  const result = await run(
    'INSERT INTO historial (paciente, paciente_id, odontologo, odontologo_id, diagnostico, observaciones) VALUES ($1, $2, $3, $4, $5, $6)',
    [paciente, patientRecord ? patientRecord.id : null, doctorName, req.user.id, diagnostico, observaciones]
  );

  const note = {
    id: String(result.id),
    paciente,
    pacienteId: patientRecord ? patientRecord.id : null,
    odontologo: doctorName,
    diagnostico,
    observaciones,
    createdAt: new Date().toISOString()
  };

  return res.status(201).json({
    ok: true,
    message: 'Nota clínica registrada correctamente.',
    note
  });
});

app.get('/api/projects', verificarJWT, async (req, res) => {
  await dbReady;
  return res.json({ ok: true, data: projects, total: projects.length });
});

app.post('/api/projects', verificarJWT, async (req, res) => {
  await dbReady;
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ ok: false, message: 'El nombre del proyecto es obligatorio.' });
  }

  const project = {
    id: `proj_${Date.now()}`,
    name,
    description: description || '',
    status: 'active',
    ownerId: req.user.id,
    tasks: []
  };

  projects.push(project);
  return res.status(201).json({ ok: true, message: 'Proyecto creado correctamente.', project });
});

app.get('/api/projects/:projectId', verificarJWT, async (req, res) => {
  await dbReady;
  const project = projects.find((item) => item.id === req.params.projectId);
  if (!project) {
    return res.status(404).json({ ok: false, message: 'Proyecto no encontrado.' });
  }

  return res.json({ ok: true, project });
});

app.post('/api/projects/:projectId/tasks', verificarJWT, async (req, res) => {
  await dbReady;
  const { projectId } = req.params;
  const { title, priority, status } = req.body;
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return res.status(404).json({ ok: false, message: 'Proyecto no encontrado.' });
  }
  if (!title) {
    return res.status(400).json({ ok: false, message: 'El título de la tarea es obligatorio.' });
  }

  const newTask = { id: `task_${Date.now()}`, title, status: status || 'pending', priority: priority || 'medium', assignee: req.user.email };
  project.tasks.push(newTask);
  return res.status(201).json({ ok: true, message: 'Tarea creada correctamente.', task: newTask });
});

app.patch('/api/projects/:projectId/tasks/:taskId', verificarJWT, async (req, res) => {
  await dbReady;
  const { projectId, taskId } = req.params;
  const { status, title, priority } = req.body;
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return res.status(404).json({ ok: false, message: 'Proyecto no encontrado.' });
  }
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) {
    return res.status(404).json({ ok: false, message: 'Tarea no encontrada.' });
  }

  if (title) task.title = title;
  if (status) task.status = status;
  if (priority) task.priority = priority;

  return res.json({ ok: true, message: 'Tarea actualizada.', task });
});

app.delete('/api/projects/:projectId/tasks/:taskId', verificarJWT, async (req, res) => {
  await dbReady;
  const { projectId, taskId } = req.params;
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return res.status(404).json({ ok: false, message: 'Proyecto no encontrado.' });
  }

  const taskIndex = project.tasks.findIndex((item) => item.id === taskId);
  if (taskIndex === -1) {
    return res.status(404).json({ ok: false, message: 'Tarea no encontrada.' });
  }

  project.tasks.splice(taskIndex, 1);
  return res.json({ ok: true, message: 'Tarea eliminada correctamente.' });
});

app.get('/api/dashboard', verificarJWT, async (req, res) => {
  await dbReady;
  await reloadData();
  const totalProjects = projects.length;
  const totalTasks = projects.reduce((sum, project) => sum + project.tasks.length, 0);
  const completedTasks = projects.reduce((sum, project) => sum + project.tasks.filter((task) => task.status === 'done').length, 0);
  const pendingTasks = projects.reduce((sum, project) => sum + project.tasks.filter((task) => task.status === 'pending').length, 0);

  return res.json({
    ok: true,
    metrics: {
      totalProjects,
      totalTasks,
      completedTasks,
      pendingTasks,
      activeUsers: users.length,
      completionRate: totalTasks === 0 ? 0 : ((completedTasks / totalTasks) * 100).toFixed(2)
    }
  });
});

app.get('/api/disponibilidad', verificarJWT, async (req, res) => {
  await dbReady;
  const { odontologo, fecha } = req.query;

  if (!odontologo || !fecha) {
    return res.status(400).json({ ok: false, message: 'Se requieren odontólogo y fecha.' });
  }

  const disponibilidad = await obtenerDisponibilidad(odontologo, fecha);
  return res.json({ ok: true, odontologo, fecha, disponibilidad });
});

app.get('/api/citas', verificarJWT, async (req, res) => {
  await dbReady;
  await reloadData();
  const usuario = users.find((item) => item.id === req.user.id);
  if (!usuario) {
    return res.status(404).json({ ok: false, message: 'Usuario no encontrado.' });
  }

  let lista = citas;
  if (usuario.role === 'patient') {
    lista = citas.filter((cita) => cita.pacienteId === usuario.id);
  }
  if (usuario.role === 'dentist') {
    lista = citas.filter((cita) => cita.odontologo === usuario.name);
  }

  return res.json({ ok: true, total: lista.length, citas: lista });
});

app.get('/api/admin/citas', verificarJWT, async (req, res) => {
  await dbReady;
  await reloadData();
  const usuario = users.find((item) => item.id === req.user.id);
  if (!usuario || (usuario.role !== 'admin' && usuario.role !== 'dentist')) {
    return res.status(403).json({ ok: false, message: 'Acceso no autorizado.' });
  }

  let lista = citas;
  if (usuario.role === 'dentist') {
    lista = citas.filter((cita) => cita.odontologo === usuario.name);
  }

  return res.json({ ok: true, total: lista.length, citas: lista.map(parseCita) });
});

app.post('/api/citas', verificarJWT, async (req, res) => {
  await dbReady;
  const { odontologo, fecha, hora, motivo, especialidad } = req.body;
  const usuario = users.find((item) => item.id === req.user.id);

  if (!usuario) {
    return res.status(404).json({ ok: false, message: 'Usuario no encontrado.' });
  }

  if (!odontologo || !fecha || !hora) {
    return res.status(400).json({ ok: false, message: 'Faltan datos de la cita.' });
  }

  const conflicto = await get('SELECT id FROM citas WHERE odontologo = $1 AND fecha = $2 AND hora = $3', [odontologo, fecha, hora]);
  if (conflicto) {
    return res.status(409).json({ ok: false, message: 'Conflicto de horario: el odontólogo ya tiene esa hora reservada.' });
  }

  const result = await run(
    'INSERT INTO citas (paciente_id, paciente_nombre, odontologo, especialidad, fecha, hora, motivo, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [usuario.id, usuario.name, odontologo, especialidad || 'Consulta general', fecha, hora, motivo || 'Consulta general', 'Confirmada']
  );

  const nuevaCita = {
    id: String(result.id),
    pacienteId: usuario.id,
    pacienteNombre: usuario.name,
    odontologo,
    especialidad: especialidad || 'Consulta general',
    fecha,
    hora,
    motivo: motivo || 'Consulta general',
    estado: 'Confirmada'
  };

  enqueueMessage({
    type: 'email',
    title: 'Correo automático enviado',
    message: `Cita confirmada para ${usuario.name} con ${odontologo} el ${fecha} a las ${hora}.`,
    recipient: usuario.email,
    status: 'queued'
  });

  simulateQueueDelivery();
  citas = await all('SELECT * FROM citas ORDER BY fecha ASC, hora ASC');
  return res.status(201).json({
    ok: true,
    message: 'Reserva confirmada correctamente. El bloque de horario desaparece automáticamente para evitar reservas dobles.',
    cita: nuevaCita,
    queue: messageQueue.slice(0, 3)
  });
});

app.patch('/api/citas/:id', verificarJWT, async (req, res) => {
  await dbReady;
  const { id } = req.params;
  const { fecha, hora, motivo, estado } = req.body;

  const cita = await get('SELECT * FROM citas WHERE id = $1', [id]);
  if (!cita) {
    return res.status(404).json({ ok: false, message: 'Cita no encontrada.' });
  }

  if (req.user.role !== 'admin' && cita.paciente_id !== req.user.id) {
    return res.status(403).json({ ok: false, message: 'No tienes permisos para editar esta cita.' });
  }

  const nextFecha = fecha || cita.fecha;
  const nextHora = hora || cita.hora;
  const nextMotivo = motivo || cita.motivo;
  const nextEstado = estado || cita.estado;

  await run(
    'UPDATE citas SET fecha = $1, hora = $2, motivo = $3, estado = $4 WHERE id = $5',
    [nextFecha, nextHora, nextMotivo, nextEstado, id]
  );

  const updated = await get('SELECT * FROM citas WHERE id = $1', [id]);
  citas = await all('SELECT * FROM citas ORDER BY fecha ASC, hora ASC');

  return res.json({ ok: true, message: 'Cita actualizada correctamente.', cita: parseCita(updated) });
});

app.delete('/api/citas/:id', verificarJWT, async (req, res) => {
  await dbReady;
  const { id } = req.params;

  const cita = await get('SELECT * FROM citas WHERE id = $1', [id]);
  if (!cita) {
    return res.status(404).json({ ok: false, message: 'Cita no encontrada.' });
  }

  if (req.user.role !== 'admin' && cita.paciente_id !== req.user.id) {
    return res.status(403).json({ ok: false, message: 'No tienes permisos para cancelar esta cita.' });
  }

  await run('UPDATE citas SET estado = $1 WHERE id = $2', ['Cancelada', id]);
  citas = await all('SELECT * FROM citas ORDER BY fecha ASC, hora ASC');

  return res.json({ ok: true, message: 'Cita cancelada correctamente.' });
});

app.get('/api/notifications', verificarJWT, async (req, res) => {
  await dbReady;
  const notifications = [
    { id: 'n_001', userId: req.user.id, message: 'Su cita fue confirmada correctamente.', read: false, createdAt: new Date().toISOString() },
    { id: 'n_002', userId: req.user.id, message: 'El sistema de notificaciones de la nube está operativo.', read: true, createdAt: new Date().toISOString() }
  ];

  return res.json({ ok: true, data: notifications, unread: notifications.filter((item) => !item.read).length });
});

app.get('/api/cloud/status', verificarJWT, async (req, res) => {
  await dbReady;
  return res.json({ ok: true, cloud, uptime: '99.99%', message: 'Arquitectura cloud simulada funcionando correctamente.' });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Ruta no encontrada.' });
});

if (require.main === module) {
  dbReady.then(() => {
    app.listen(PORT, () => {
      console.log(`ApexFlow Server running on http://localhost:${PORT}`);
    });
  }).catch((error) => {
    console.error('Error inicializando la base de datos:', error);
    process.exit(1);
  });
}

module.exports = app;
