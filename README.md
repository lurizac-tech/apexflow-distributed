# ApexFlow

ApexFlow es un prototipo de SaaS para gestión clínica odontológica, orientado a digitalizar procesos de agendamiento, atención, historial clínico, administración de citas y notificaciones de pacientes. La aplicación combina una API REST en Node.js con Express, una interfaz web estática y una capa de persistencia en SQLite para simular un entorno cloud con lógica de negocio realista y segura.

## Caso de estudio

El caso de estudio plantea una clínica dental que necesita centralizar la reserva de citas, la administración del calendario médico, la gestión de pacientes y el acceso diferenciado por roles. El sistema debe permitir:

- Registro e inicio de sesión con JWT
- Agendamiento de citas por especialista y fecha
- Visualización de disponibilidad por odontólogo
- Gestión de citas por parte del administrador
- Control de acceso a datos clínicos según el rol
- Simulación de arquitectura cloud con servicios de autenticación, API gateway y notificaciones

## Integrantes del proyecto

- Arquitectura y backend: Equipo ApexFlow
- Frontend y UX: Equipo ApexFlow
- Persistencia y cloud simulation: Equipo ApexFlow

## Objetivos del prototipo

- Validar una solución SaaS para clínicas odontológicas.
- Implementar autenticación segura con JWT.
- Proveer una experiencia de usuario moderna y responsiva.
- Demostrar una arquitectura basada en capas y servicios distribuidos simulados.
- Documentar el funcionamiento con requisitos, diagramas UML y patrones cloud.

## Requisitos funcionales y no funcionales

### Requisitos funcionales

- RF-01: Registro de usuarios
- RF-02: Inicio de sesión con JWT
- RF-03: Consulta del perfil autenticado y acceso a información del usuario
- RF-04: Gestión de proyectos y escenarios de trabajo
- RF-05: Gestión de tareas dentro de un proyecto
- RF-06: Dashboard con métricas y estado del negocio
- RF-07: Notificaciones y estado del sistema cloud

### Requisitos no funcionales

- RNF-01: Seguridad mediante autenticación y autorización por token
- RNF-02: Persistencia de datos con SQLite
- RNF-03: Compatibilidad con navegadores modernos y responsive design
- RNF-04: Mantenibilidad del código y separación de responsabilidades
- RNF-05: Simulación de arquitectura cloud y servicios desacoplados

## Estructura del repositorio

```text
Prototipo-apexflow/
├── .env.example              # Variables de entorno de ejemplo
├── .gitignore                # Archivos ignorados por Git
├── data/
│   └── apexflow.db          # Base de datos SQLite local
├── node_modules/            # Dependencias instaladas
├── public/
│   ├── app.js               # Lógica del cliente web
│   ├── index.html           # Interfaz principal de la aplicación
│   └── styles.css           # Estilos visuales del dashboard
├── src/
│   ├── app.js               # Bootstrap de la app (legacy / referencia)
│   ├── db.js                # Inicialización y acceso a SQLite
│   └── server.js            # Servidor Express principal con API REST
├── tests/
│   └── api.admin.test.js    # Pruebas de validación de citas y administración
├── package.json             # Metadatos del proyecto y scripts
├── package-lock.json        # Lockfile de dependencias
├── README.md                # Documentación principal
└── .env                     # Configuración local del entorno (no versionado)
```

## Requisitos previos

- Node.js 18 o superior
- npm 9 o superior
- Git para clonado

## Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/apexflow.git
cd Prototipo-apexflow
```

## Instalación de dependencias

```bash
npm install
```

## Configuración de entorno

Copia el ejemplo de variables de entorno:

```bash
copy .env.example .env
```

O en Linux/macOS:

```bash
cp .env.example .env
```

Contenido sugerido:

```env
PORT=3000
JWT_SECRET=supersecretkey
JWT_EXPIRES_IN=1h
```

## Ejecutar la aplicación

Modo producción:

```bash
npm start
```

Modo desarrollo:

```bash
npm run dev
```

La API y la interfaz estarán disponibles en:

- Frontend web: http://localhost:3000
- Health check: http://localhost:3000/health

## Credenciales de demostración

```text
Administrador:
- Email: admin@apexflow.com
- Password: admin123

Paciente:
- Email: paciente@apexflow.com
- Password: paciente123
```

## Demo desplegada en la nube

URL de demostración pública (pendiente de publicación real del despliegue):

```text
https://apexflow-demo.example.com
```

> Reemplazar esta URL por la dirección real del hosting una vez publicado el proyecto en Render, Vercel, Railway o un servicio equivalente.

## Requerimientos y trazabilidad del proyecto

La siguiente matriz relaciona cada requisito, su diagrama UML conceptual, el patrón cloud asociado y el archivo fuente donde se implementa la lógica principal.

| Código | Descripción | Diagrama UML relacionado | Patrón Cloud / Arquitectura | Archivo fuente principal |
|---|---|---|---|---|
| RF-01 | Registro de usuarios | Caso de uso: Registro | API Gateway + autenticación centralizada | src/server.js |
| RF-02 | Inicio de sesión con JWT | Caso de uso: Login seguro | Token-based auth / JWT | src/server.js |
| RF-03 | Consulta del perfil autenticado | Caso de uso: Perfil de usuario | Seguridad y sesión stateless | src/server.js |
| RF-04 | Gestión de proyectos | Diagrama de clases / casos de uso de proyectos | Microservicios simulados / capa de dominio | src/server.js |
| RF-05 | Gestión de tareas | Diagrama de actividades de flujo de trabajo | Orquestación interna de servicios | src/server.js |
| RF-06 | Dashboard y métricas | Diagrama de componentes | Analytics / observabilidad / API dashboard | src/server.js |
| RF-07 | Notificaciones y estado cloud | Diagrama de despliegue y componentes | API Gateway + observabilidad + cloud fake | src/server.js |
| RNF-01 | Seguridad con autenticación y control de acceso | Diagrama de secuencia de login | JWT + middleware de autorización | src/server.js |
| RNF-02 | Persistencia de datos | Diagrama de clases / modelo de datos | Base de datos relacional local (SQLite) | src/db.js |
| RNF-03 | Interfaz responsiva | Diagrama de componentes UI | Frontend estático servido por Express | public/index.html, public/styles.css, public/app.js |
| RNF-04 | Mantenibilidad | Diagrama de capas | Arquitectura por capas | src/server.js, src/db.js |
| RNF-05 | Simulación cloud | Diagrama de despliegue conceptual | API Gateway + servicios simulados | src/server.js |

## Diagramas UML (conceptuales)

El proyecto se apoya en una arquitectura basada en casos de uso, componentes y despliegue. Los diagramas conceptuales más relevantes son:

1. Diagrama de casos de uso
   - Registro e inicio de sesión
   - Agendamiento y edición de citas
   - Administración de pacientes y flujo de la clínica

2. Diagrama de clases
   - Usuario
   - Cita
   - Odontólogo
   - Historial clínico
   - Notificación

3. Diagrama de componentes
   - Frontend web
   - API REST
   - Middleware JWT
   - Capa de datos SQLite
   - Módulo de monitoreo y cloud status

4. Diagrama de despliegue conceptual
   - Cliente web
   - API Gateway Express
   - Servicios de autenticación, citas y dashboard
   - Persistencia SQLite
   - Cloud simulation layer

## Patrón cloud implementado

La solución simula una arquitectura cloud moderna con una estructura inspirada en patrones de producción:

- API Gateway: Express como puerta de entrada para la API REST
- Seguridad: JWT y middleware de autorización
- Capa de negocio: lógica centralizada en src/server.js
- Persistencia: SQLite como capa de almacenamiento local real
- Frontend estático: archivos HTML/CSS/JS servidos por Express
- Observabilidad: endpoint /health y /api/cloud/status

## Scripts disponibles

```bash
npm start
npm run dev
```

## Pruebas

Se incluye validación de flujo de citas y administración mediante Node Test:

```bash
node --test tests/api.admin.test.js
```

## Notas de implementación

- La aplicación guarda usuarios y citas de forma persistente en SQLite.
- Los accesos están protegidos por JWT con manejo de roles.
- El cliente web usa localStorage para conservar la sesión del usuario.
- La administración de citas permite edición y cancelación en el panel admin.

## Licencia

Este proyecto está desarrollado para fines académicos y de prototipado bajo la licencia ISC.

## Resumen ejecutivo

ApexFlow es una propuesta funcional para una clínica odontológica digital, integrando autenticación, agendamiento, administración y capa cloud simulada. El prototipo demuestra cómo una aplicación web tradicional puede evolucionar hacia un SaaS orientado a procesos hospitalarios y operativos con control de acceso, persistencia y trazabilidad.
