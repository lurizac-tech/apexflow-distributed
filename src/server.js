const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const dotenv = require('dotenv');
const { initDatabase, run, get, all, findUserByEmail } = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'apexflow-secret-dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const dbReady = initDatabase();

const cloud = {
  name: 'ApexFlow Cloud',
  region: 'us-east-1',
  status: 'simulado',
  gateway: 'api.apexflow.local',
  services: ['auth', 'projects', 'tasks', 'notifications', 'analytics']
};

const horariosDisponibles = ['09:30', '10:15', '11:00', '12:45'];
let users = [];
let citas = [];
let projects = [];
let messageQueue = [];

function enqueueMessage({ type, title, message, recipient, status = 'queued' }) {
  const event = {
    id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type,
    title,
    message,
    recipient,
    status,
    createdAt: new Date().toISOString()
  };

  messageQueue.unshift(event);
  return event;
}

function simulateQueueDelivery() {
  const pending = messageQueue.filter((item) => item.status === 'queued');
  pending.forEach((item) => {
    item.status = 'sent';
    item.sentAt = new Date().toISOString();
  });
  return pending;
}

async function reloadData() {
  await dbReady;
  users = await all('SELECT * FROM users');
  citas = await all('SELECT * FROM citas ORDER BY fecha ASC, hora ASC');
  projects = [
    {
      id: 'proj_001',
      name: 'ApexFlow MVP',
      description: 'Proyecto base para gestionar flujos y tareas de trabajo.',
      status: 'active',
      ownerId: 1,
      tasks: [
        { id: 'task_01', title: 'Configurar API', status: 'done', priority: 'high', assignee: 'admin@apexflow.com' },
        { id: 'task_02', title: 'Diseñar dashboard', status: 'in_progress', priority: 'medium', assignee: 'admin@apexflow.com' },
        { id: 'task_03', title: 'Validar autenticación', status: 'pending', priority: 'high', assignee: 'admin@apexflow.com' }
      ]
    }
  ];
}

function parseCita(row) {
  return {
    id: String(row.id),
    pacienteId: row.paciente_id,
    pacienteNombre: row.paciente_nombre,
    odontologo: row.odontologo,
    especialidad: row.especialidad,
    fecha: row.fecha,
    hora: row.hora,
    motivo: row.motivo,
    estado: row.estado
  };
}

async function obtenerDisponibilidad(odontologo, fecha) {
  await dbReady;
  const rows = await all('SELECT hora FROM citas WHERE odontologo = $1 AND fecha = $2', [odontologo, fecha]);
  const ocupadas = rows.map((row) => row.hora);
  return horariosDisponibles.filter((hora) => !ocupadas.includes(hora));
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verificarJWT(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      message: 'Token requerido. Usa Authorization: Bearer <token>'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(403).json({
      ok: false,
      message: 'Token inválido o expirado.'
    });
  }
}

async function getCurrentUser(email) {
  return findUserByEmail(email);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/health', async (req, res) => {
  await dbReady;
  res.json({
    ok: true,
    service: 'ApexFlow API Gateway',
    environment: 'cloud-simulado',
    cloud,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/auth/register', async (req, res) => {
  await dbReady;
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, message: 'Nombre, email y contraseña son requeridos.' });
  }

  const alreadyExists = users.some((user) => user.email === email);
  if (alreadyExists) {
    return res.status(409).json({ ok: false, message: 'El usuario ya existe.' });
  }

  const newUser = {
    id: Date.now(),
    name,
    email,
    password,
    role: 'user'
  };

  await run('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)', [name, email, password, 'user']);
  users = await all('SELECT * FROM users');
  const token = generateToken(newUser);

  return res.status(201).json({
    ok: true,
    message: 'Usuario registrado correctamente.',
    token,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }
  });
});

app.post('/api/auth/login', async (req, res) => {
  await dbReady;
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: 'Email y contraseña son requeridos.' });
  }

  await reloadData();
  const user = await getCurrentUser(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ ok: false, message: 'Credenciales inválidas.' });
  }

  const token = generateToken(user);

  return res.json({
    ok: true,
    message: 'Login exitoso.',
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.get('/api/users/me', verificarJWT, async (req, res) => {
  await dbReady;
  await reloadData();
  const user = users.find((item) => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ ok: false, message: 'Usuario no encontrado.' });
  }

  return res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/queue', verificarJWT, async (req, res) => {
  await dbReady;
  simulateQueueDelivery();
  return res.json({ ok: true, queue: messageQueue.slice(0, 6), total: messageQueue.length });
});

app.get('/api/historial', verificarJWT, async (req, res) => {
  await dbReady;
  const { paciente } = req.query;
  const rows = await all('SELECT * FROM historial ORDER BY created_at DESC');

  let notes = rows;
  if (req.user.role === 'patient') {
    notes = rows.filter((note) => note.paciente === req.user.name);
  }

  if (paciente) {
    notes = notes.filter((note) => note.paciente.toLowerCase().includes(String(paciente).toLowerCase()));
  }

  if (req.user.role === 'dentist' || req.user.role === 'admin') {
    notes = rows;
    if (paciente) {
      notes = notes.filter((note) => note.paciente.toLowerCase().includes(String(paciente).toLowerCase()));
    }
  }

  return res.json({
    ok: true,
    total: notes.length,
    notes: notes.map((note) => ({
      id: String(note.id),
      paciente: note.paciente,
      odontologo: note.odontologo,
      diagnostico: note.diagnostico,
      observaciones: note.observaciones,
      createdAt: note.created_at
    }))
  });
});

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
