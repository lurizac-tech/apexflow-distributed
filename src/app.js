const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({
    name: 'Prototipo ApexFlow',
    status: 'ok',
    message: 'API funcionando correctamente.'
  });
});

app.use('/api', routes);

module.exports = app;
