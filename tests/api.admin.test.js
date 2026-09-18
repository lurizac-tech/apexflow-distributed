const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');
const { run } = require('../src/db');

async function withServer(fn) {
  await run('DELETE FROM citas');

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    server.close();
  }
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload.token;
}

function uniqueFutureDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
}

test('POST /api/citas crea una cita y la devuelve', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'paciente@apexflow.com', 'paciente123');
    const fecha = uniqueFutureDate(30);

    const response = await fetch(`${baseUrl}/api/citas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        odontologo: 'Dra. Ana Gómez',
        fecha,
        hora: '14:30',
        motivo: 'Consulta de seguimiento',
        especialidad: 'Endodoncia'
      })
    });

    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.match(payload.message, /Reserva confirmada correctamente\./);
    assert.ok(payload.cita && payload.cita.id);
    assert.ok(Array.isArray(payload.queue));
  });
});

test('GET /api/citas para odontólogo solo muestra citas de su agenda', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'dentista@apexflow.com', 'dentista123');

    const response = await fetch(`${baseUrl}/api/citas`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.ok(Array.isArray(payload.citas));
    assert.ok(payload.citas.every((cita) => cita.odontologo === 'Dra. Ana Gómez'));
  });
});

test('GET /api/admin/citas permite al dentista ver su agenda', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'dentista@apexflow.com', 'dentista123');

    const response = await fetch(`${baseUrl}/api/admin/citas`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.ok(Array.isArray(payload.citas));
    assert.ok(payload.citas.every((cita) => cita.odontologo === 'Dra. Ana Gómez'));
  });
});

test('PATCH /api/citas/:id actualiza la cita', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'paciente@apexflow.com', 'paciente123');
    const fecha = uniqueFutureDate(32);

    const createResponse = await fetch(`${baseUrl}/api/citas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        odontologo: 'Dr. Luis Ramírez',
        fecha,
        hora: '16:15',
        motivo: 'Primera valoración',
        especialidad: 'Implantología'
      })
    });

    const created = await createResponse.json();
    assert.equal(createResponse.status, 201, JSON.stringify(created));

    const id = created.cita.id;
    const response = await fetch(`${baseUrl}/api/citas/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        motivo: 'Valoración actualizada',
        hora: '13:30'
      })
    });

    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.cita.motivo, 'Valoración actualizada');
    assert.equal(payload.cita.hora, '13:30');
  });
});

test('DELETE /api/citas/:id cancela la reserva', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'paciente@apexflow.com', 'paciente123');
    const fecha = uniqueFutureDate(35);

    const createResponse = await fetch(`${baseUrl}/api/citas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        odontologo: 'Dra. Sofía Morales',
        fecha,
        hora: '09:00',
        motivo: 'Ortodoncia',
        especialidad: 'Ortodoncia'
      })
    });

    const created = await createResponse.json();
    assert.equal(createResponse.status, 201, JSON.stringify(created));

    const id = created.cita.id;
    const response = await fetch(`${baseUrl}/api/citas/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.message, 'Cita cancelada correctamente.');
  });
});

test('POST /api/historial permite al odontólogo registrar una nota clínica', async () => {
  await withServer(async (baseUrl) => {
    const doctorToken = await login(baseUrl, 'dentista@apexflow.com', 'dentista123');

    const response = await fetch(`${baseUrl}/api/historial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${doctorToken}`
      },
      body: JSON.stringify({
        paciente: 'María López',
        diagnostico: 'Gingivitis leve',
        observaciones: 'Se observa ligera inflamación gingival y se recomienda profilaxis. Se agenda control en 30 días.'
      })
    });

    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.equal(payload.note.paciente, 'María López');
    assert.equal(payload.note.diagnostico, 'Gingivitis leve');
    assert.ok(payload.note.id);

    const historyResponse = await fetch(`${baseUrl}/api/historial?paciente=${encodeURIComponent('María López')}`, {
      headers: {
        Authorization: `Bearer ${doctorToken}`
      }
    });

    const historyPayload = await historyResponse.json();
    assert.equal(historyResponse.status, 200, JSON.stringify(historyPayload));
    assert.ok(Array.isArray(historyPayload.notes));
    assert.ok(historyPayload.notes.some((note) => note.paciente === 'María López'));
  });
});
