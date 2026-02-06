const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const checkoutRoutes = require('./routes/checkout');

const app = express();
app.use(bodyParser.json());

// Routes
app.use('/checkout', checkoutRoutes);

// Basic health check
app.get('/', (req, res) => res.send('Checkout API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
