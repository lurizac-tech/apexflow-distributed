const API_URL = window.location.origin;
const TOKEN_KEY = 'apexflow_token';

const loginCard = document.getElementById('loginCard');
const workspace = document.getElementById('workspace');
const loginForm = document.getElementById('loginForm');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const statusBadge = document.querySelector('.status-badge');
const logoutBtn = document.getElementById('logoutBtn');
const citasTableBody = document.querySelector('#citas-panel tbody');
const adminTableBody = document.querySelector('#admin-panel tbody');
const historialTableBody = document.querySelector('#historialTableBody');
const historialSummary = document.getElementById('historialSummary');
const jwtTokenPreview = document.getElementById('jwtTokenPreview');

let currentUser = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setAuthHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...setAuthHeader(),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    if (!endpoint.startsWith('/api/auth/')) {
      clearSessionState();
      showLoginScreen();
      showAlert('error', 'La sesión expiró. Inicia sesión nuevamente.');
    }
    throw new Error(payload.message || 'Token inválido o expirado.');
  }

  if (!response.ok) {
    throw new Error(payload.message || 'Error en la solicitud');
  }

  return payload;
}

function clearSessionState() {
  localStorage.removeItem(TOKEN_KEY);
  currentUser = null;
  updateJwtPreview();
  updateRoleTheme('guest');

  if (statusBadge) {
    statusBadge.innerHTML = '<span class="status-dot"></span> Inicia sesión';
  }

  if (logoutBtn) logoutBtn.classList.add('hidden');
}

function showLoginScreen() {
  clearSessionState();

  if (loginCard) loginCard.style.display = 'grid';
  if (workspace) workspace.classList.remove('active');
}

function showAlert(type, message) {
  const isSuccess = type === 'success';
  const toast = document.createElement('div');
  const label = isSuccess ? 'Éxito' : 'Error';

  toast.className = 'toast-message';
  toast.dataset.type = type;
  toast.innerHTML = `
    <span class="toast-icon">${isSuccess ? '✓' : '!'}</span>
    <div>
      <strong>${label}</strong>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function updateJwtPreview(token = '') {
  if (!jwtTokenPreview) return;
  jwtTokenPreview.textContent = token ? `${token.slice(0, 20)}...` : 'sin token activo';
}

function updateRoleTheme(role = 'guest') {
  document.body.dataset.role = role;
}

function renderCitas(citas = []) {
  if (!citasTableBody) return;
  citasTableBody.innerHTML = '';

  if (!citas.length) {
    citasTableBody.innerHTML = '<tr><td colspan="5">No hay citas registradas.</td></tr>';
    return;
  }

  citas.forEach((cita) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${cita.odontologo}</td>
      <td>${cita.fecha}</td>
      <td>${cita.hora}</td>
      <td>${cita.especialidad || 'Consulta general'}</td>
      <td>
        <span class="status-pill ${cita.estado === 'Confirmada' ? 'status-confirmed' : 'status-cancelled'}">${cita.estado}</span>
      </td>
    `;
    citasTableBody.appendChild(row);
  });
}

function renderAdminCitas(citas = []) {
  if (!adminTableBody) return;
  adminTableBody.innerHTML = '';

  if (!citas.length) {
    adminTableBody.innerHTML = '<tr><td colspan="6">No hay citas para administrar.</td></tr>';
    return;
  }

  citas.forEach((cita) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${cita.pacienteNombre || 'Paciente'}</td>
      <td>${cita.odontologo}</td>
      <td>${cita.fecha}</td>
      <td>${cita.hora}</td>
      <td><span class="status-pill ${cita.estado === 'Confirmada' ? 'status-confirmed' : 'status-cancelled'}">${cita.estado}</span></td>
      <td>
        <button class="table-action edit" data-action="edit" data-id="${cita.id}">Editar</button>
        <button class="table-action cancel" data-action="cancel" data-id="${cita.id}">Cancelar</button>
      </td>
    `;
    adminTableBody.appendChild(row);
  });
}

function renderQueue(items = []) {
  const queueList = document.getElementById('queueList');
  if (!queueList) return;

  if (!items.length) {
    queueList.innerHTML = '<li class="notification-empty">Sin mensajes en cola.</li>';
    return;
  }

  queueList.innerHTML = items.map((item) => `
    <li class="notification-item ${item.status === 'sent' ? 'is-sent' : 'is-queued'}">
      <div class="notification-header">
        <span class="notification-status">${item.status === 'sent' ? '✓ Enviado' : '⏳ En cola'}</span>
        <span class="notification-type">${item.type === 'email' ? 'Correo' : 'Sistema'}</span>
      </div>
      <strong>${item.title}</strong>
      <div class="notification-body">${item.message}</div>
      ${item.recipient ? `<small>${item.recipient}</small>` : ''}
    </li>
  `).join('');
}

function renderHistorialNotas(notes = []) {
  if (!historialTableBody) return;

  if (!notes.length) {
    historialTableBody.innerHTML = '<tr><td colspan="5">Sin registros clínicos disponibles.</td></tr>';
    return;
  }

  historialTableBody.innerHTML = notes.map((note) => `
    <tr>
      <td>${new Date(note.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>${note.paciente}</td>
      <td>${note.diagnostico}</td>
      <td>${note.odontologo}</td>
      <td>${note.observaciones}</td>
    </tr>
  `).join('');
}

function renderHistorialSummary(notes = []) {
  if (!historialSummary) return;

  const total = notes.length;
  const latest = notes[0]?.createdAt ? new Date(notes[0].createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin registros';
  const paciente = notes[0]?.paciente || '—';

  historialSummary.innerHTML = `
    <div class="summary-card accent">
      <span class="summary-label">Notas registradas</span>
      <strong>${total}</strong>
    </div>
    <div class="summary-card">
      <span class="summary-label">Última revisión</span>
      <strong>${latest}</strong>
    </div>
    <div class="summary-card">
      <span class="summary-label">Paciente activo</span>
      <strong>${paciente}</strong>
    </div>
  `;
}

async function cargarHistorial() {
  try {
    const data = await apiRequest('/api/historial');
    const notes = data.notes || [];
    renderHistorialNotas(notes);
    renderHistorialSummary(notes);
  } catch (error) {
    console.error(error);
    renderHistorialNotas([]);
    renderHistorialSummary([]);
  }
}

async function cargarQueue() {
  try {
    const data = await apiRequest('/api/queue');
    renderQueue(data.queue || []);
  } catch (error) {
    console.error(error);
    renderQueue([]);
  }
}

async function cargarCitas() {
  try {
    const data = await apiRequest('/api/citas');
    renderCitas(data.citas || []);
  } catch (error) {
    console.error(error);
    showAlert('error', error.message);
  }
}

async function cargarAdminCitas() {
  try {
    const data = await apiRequest('/api/admin/citas');
    renderAdminCitas(data.citas || []);
  } catch (error) {
    console.error(error);
    showAlert('error', error.message);
  }
}

async function cargarDisponibilidad() {
  const doctorSelect = document.querySelector('#agenda-panel select');
  const fechaInput = document.querySelector('#agenda-panel input[type="date"]');
  const horarioSelect = document.querySelectorAll('#agenda-panel select')[2];

  if (!doctorSelect || !fechaInput || !horarioSelect) return;

  const odontologo = doctorSelect.value;
  const fecha = fechaInput.value;

  if (!odontologo || !fecha) return;

  try {
    const data = await apiRequest(`/api/disponibilidad?odontologo=${encodeURIComponent(odontologo)}&fecha=${encodeURIComponent(fecha)}`);
    horarioSelect.innerHTML = '';

    if (!data.disponibilidad || data.disponibilidad.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Sin disponibilidad';
      horarioSelect.appendChild(option);
      return;
    }

    data.disponibilidad.forEach((hora) => {
      const option = document.createElement('option');
      option.value = hora;
      option.textContent = hora;
      horarioSelect.appendChild(option);
    });
  } catch (error) {
    console.error(error);
    showAlert('error', error.message);
  }
}

function applyRolePermissions(role) {
  const historialTab = document.querySelector('.tab-btn[data-tab="historial"]');
  const historialPanel = document.getElementById('historial-panel');
  const adminTab = document.querySelector('.tab-btn[data-tab="admin"]');
  const agendaTab = document.querySelector('.tab-btn[data-tab="agenda"]');
  const citasTab = document.querySelector('.tab-btn[data-tab="citas"]');

  if (!historialTab) return;

  if (role === 'patient') {
    historialTab.style.display = 'none';
    if (historialPanel) historialPanel.remove();

    if (adminTab) adminTab.style.display = 'none';

    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && (activeTab.dataset.tab === 'historial' || activeTab.dataset.tab === 'admin')) {
      if (agendaTab) agendaTab.click();
    }
  } else if (role === 'dentist') {
    historialTab.style.display = 'inline-flex';
    if (adminTab) adminTab.style.display = 'none';
    if (agendaTab) agendaTab.textContent = 'Mi Agenda';
    if (citasTab) citasTab.textContent = 'Agenda de Pacientes';

    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.dataset.tab === 'admin') {
      if (agendaTab) agendaTab.click();
    }
  } else {
    historialTab.style.display = 'inline-flex';
    if (adminTab) adminTab.style.display = 'inline-flex';
    if (agendaTab) agendaTab.textContent = 'Agendar Cita';
    if (citasTab) citasTab.textContent = 'Mis Citas';
  }
}

async function loginWithCredentials(email, password) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    updateJwtPreview();

    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    localStorage.setItem(TOKEN_KEY, result.token);
    currentUser = result.user;
    updateJwtPreview(result.token);
    updateRoleTheme(currentUser.role);

    const roleLabels = {
      patient: 'Paciente',
      dentist: 'Odontólogo',
      admin: 'Administrador'
    };

    if (statusBadge) {
      statusBadge.innerHTML = `<span class="status-dot"></span> Sesión activa · ${roleLabels[currentUser.role] || 'Usuario'}`;
    }

    if (logoutBtn) logoutBtn.classList.remove('hidden');

    const doctorSelect = document.querySelector('#agenda-panel select');
    if (currentUser.role === 'dentist' && doctorSelect) {
      const availableDoctors = Array.from(doctorSelect.options).map((option) => option.value);
      if (availableDoctors.includes(currentUser.name)) {
        doctorSelect.value = currentUser.name;
      } else {
        doctorSelect.selectedIndex = 0;
      }
    }

    await cargarQueue();
    loginCard.style.display = 'none';
    workspace.classList.add('active');
    applyRolePermissions(currentUser.role);
    await cargarDisponibilidad();
    await cargarCitas();
    await cargarHistorial();
    if (currentUser.role === 'admin' || currentUser.role === 'dentist') {
      await cargarAdminCitas();
    }

    return result;
  } catch (error) {
    showAlert('error', error.message);
    throw error;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showAlert('error', 'Debes ingresar email y contraseña.');
    return;
  }

  localStorage.removeItem(TOKEN_KEY);
  await loginWithCredentials(email, password);
});

function bindAgendaEvents() {
  const doctorSelect = document.querySelector('#agenda-panel select');
  const fechaInput = document.querySelector('#agenda-panel input[type="date"]');

  if (doctorSelect) {
    doctorSelect.addEventListener('change', cargarDisponibilidad);
  }

  if (fechaInput) {
    fechaInput.addEventListener('change', cargarDisponibilidad);
  }
}

async function reservarCita() {
  const doctorSelect = document.querySelector('#agenda-panel select');
  const fechaInput = document.querySelector('#agenda-panel input[type="date"]');
  const horarioSelect = document.querySelectorAll('#agenda-panel select')[2];
  const motivoInput = document.querySelector('#agenda-panel textarea');

  if (!doctorSelect || !fechaInput || !horarioSelect) {
    showAlert('error', 'Completa la información de la cita.');
    return;
  }

  const payload = {
    odontologo: doctorSelect.value,
    fecha: fechaInput.value,
    hora: horarioSelect.value,
    motivo: motivoInput ? motivoInput.value : 'Consulta general',
    especialidad: doctorSelect.value.includes('Ana') ? 'Endodoncia' : 'Consulta general'
  };

  if (!payload.odontologo || !payload.fecha || !payload.hora) {
    showAlert('error', 'Selecciona odontólogo, fecha y hora disponibles.');
    return;
  }

  try {
    const result = await apiRequest('/api/citas', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const horarioSelect = document.querySelectorAll('#agenda-panel select')[2];
    if (horarioSelect && payload.hora) {
      const optionToRemove = Array.from(horarioSelect.options).find((option) => option.value === payload.hora);
      if (optionToRemove) {
        horarioSelect.removeChild(optionToRemove);
      }
    }

    if (result.queue && result.queue.length) {
      renderQueue(result.queue);
    } else {
      await cargarQueue();
    }

    showAlert('success', result.message || 'Reserva confirmada correctamente.');
    await cargarDisponibilidad();
    await cargarCitas();
  } catch (error) {
    showAlert('error', error.message);
  }
}

const agendaButton = document.querySelector('#agenda-panel .primary-btn');
if (agendaButton) {
  agendaButton.addEventListener('click', reservarCita);
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    tabButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
    tabPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === `${button.dataset.tab}-panel`);
    });

    if (button.dataset.tab === 'agenda') {
      cargarDisponibilidad();
    }

    if (button.dataset.tab === 'citas') {
      cargarCitas();
    }

    if (button.dataset.tab === 'historial') {
      cargarHistorial();
    }

    if (button.dataset.tab === 'admin') {
      cargarAdminCitas();
    }
  });
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const id = target.dataset.id;
  const action = target.dataset.action;

  try {
    if (action === 'cancel') {
      const response = await apiRequest(`/api/citas/${id}`, { method: 'DELETE' });
      showAlert('success', response.message);
      await cargarAdminCitas();
      await cargarCitas();
      return;
    }

    if (action === 'edit') {
      const cita = (await apiRequest('/api/admin/citas')).citas.find((item) => String(item.id) === String(id));
      const nextHora = window.prompt('Nueva hora (HH:MM)', cita ? cita.hora : '09:30');
      const nextMotivo = window.prompt('Nuevo motivo de la cita', cita ? cita.motivo : 'Consulta general');

      if (!nextHora || !nextMotivo) return;

      const response = await apiRequest(`/api/citas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ hora: nextHora, motivo: nextMotivo })
      });

      showAlert('success', response.message || 'Cita actualizada');
      await cargarAdminCitas();
      await cargarCitas();
    }
  } catch (error) {
    showAlert('error', error.message);
  }
});

const refreshAdminBtn = document.getElementById('refreshAdminBtn');
if (refreshAdminBtn) {
  refreshAdminBtn.addEventListener('click', cargarAdminCitas);
}

async function guardarNotaClinica() {
  const paciente = document.getElementById('historialPaciente')?.value?.trim();
  const diagnostico = document.getElementById('historialDiagnostico')?.value?.trim();
  const observaciones = document.getElementById('historialObservaciones')?.value?.trim();

  if (!paciente || !diagnostico || !observaciones) {
    showAlert('error', 'Completa paciente, diagnóstico y observaciones.');
    return;
  }

  try {
    const response = await apiRequest('/api/historial', {
      method: 'POST',
      body: JSON.stringify({ paciente, diagnostico, observaciones })
    });
    showAlert('success', response.message || 'Nota clínica registrada correctamente.');
    await cargarHistorial();
  } catch (error) {
    showAlert('error', error.message);
  }
}

const guardarDiagnosticoBtn = document.getElementById('guardarDiagnosticoBtn');
if (guardarDiagnosticoBtn) {
  guardarDiagnosticoBtn.addEventListener('click', guardarNotaClinica);
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    showLoginScreen();
    showAlert('success', 'Sesión cerrada correctamente.');
  });
}

bindAgendaEvents();

async function restoreSessionFromToken() {
  const savedToken = getToken();

  if (!savedToken) {
    updateJwtPreview();
    updateRoleTheme('guest');
    if (loginCard) loginCard.style.display = 'grid';
    if (workspace) workspace.classList.remove('active');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (statusBadge) {
      statusBadge.innerHTML = '<span class="status-dot"></span> Inicia sesión';
    }
    return;
  }

  try {
    const response = await apiRequest('/api/users/me');
    currentUser = response.user;
    updateJwtPreview(savedToken);
    updateRoleTheme(currentUser.role);
    if (statusBadge) {
      const roleLabels = {
        patient: 'Paciente',
        dentist: 'Odontólogo',
        admin: 'Administrador'
      };
      statusBadge.innerHTML = `<span class="status-dot"></span> Sesión activa · ${roleLabels[currentUser.role] || 'Usuario'}`;
    }
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    loginCard.style.display = 'none';
    workspace.classList.add('active');
    applyRolePermissions(currentUser.role);
    await cargarDisponibilidad();
    await cargarCitas();
    await cargarHistorial();
    if (currentUser.role === 'admin' || currentUser.role === 'dentist') {
      await cargarAdminCitas();
    }
  } catch (error) {
    clearSessionState();
    showLoginScreen();
    showAlert('error', 'La sesión anterior expiró. Inicia sesión nuevamente.');
  }
}

restoreSessionFromToken();
